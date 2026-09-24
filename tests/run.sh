#!/usr/bin/env bash
# datvps - bộ kiểm thử: cú pháp, shellcheck, unit test hàm thuần, render docker compose.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0 FAIL=0

t() { # t "mô tả" lệnh...
  local desc=$1; shift
  if "$@" >/dev/null 2>&1; then PASS=$((PASS + 1)); printf '  ok   %s\n' "$desc"
  else FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$desc"; fi
}
not() { ! "$@"; }
eq() { [[ "$1" == "$2" ]] || { printf '       expected [%s] got [%s]\n' "$2" "$1" >&2; return 1; }; }

echo "== Cú pháp bash"
for f in "$ROOT"/bin/dat "$ROOT"/install.sh "$ROOT"/lib/*.sh "$ROOT"/tests/run.sh; do
  t "bash -n ${f#"$ROOT"/}" bash -n "$f"
done

echo "== shellcheck"
if command -v shellcheck >/dev/null 2>&1; then
  t "shellcheck bin/dat (kèm lib/)" shellcheck -x "$ROOT/bin/dat"
  t "shellcheck install.sh" shellcheck "$ROOT/install.sh"
else
  echo "  (bỏ qua: chưa cài shellcheck)"
fi

echo "== Unit test"
TMPROOT=$(mktemp -d)
trap 'rm -rf "$TMPROOT"' EXIT
export DATVPS_HOME="$ROOT" DATVPS_CONF="$TMPROOT/none.conf" SITES_DIR="$TMPROOT/sites"
# shellcheck source=../lib/common.sh
. "$ROOT/lib/common.sh"

t "domain hợp lệ: example.com"        valid_domain example.com
t "domain hợp lệ: sub.my-site.co.uk"  valid_domain sub.my-site.co.uk
t "domain hợp lệ: IDN xn--80ak6aa92e.com" valid_domain xn--80ak6aa92e.com
t "domain hợp lệ: chữ hoa"             valid_domain Example.COM
t "domain sai: localhost"             not valid_domain localhost
t "domain sai: -bad.com"              not valid_domain -bad.com
t "domain sai: có dấu cách"           not valid_domain "a b.com"
t "domain sai: có path"               not valid_domain "a.com/x"
t "domain sai: TLD số"                not valid_domain "1.2.3.4"
t "domain sai: chèn lệnh"             not valid_domain 'a.com;rm -rf /'
t "email hợp lệ"                      valid_email you@gmail.com
t "email sai"                         not valid_email "you@"
t "id hợp lệ"                         valid_id example-com-3f2a
t "id sai: ../"                       not valid_id "../etc"
t "hosts_for không www"               eq "$(hosts_for a.com 0)" "a.com"
t "hosts_for có www"                  eq "$(hosts_for a.com 1)" "a.com,www.a.com"
t "rand_str độ dài 32"                eq "$(rand_str 32 | wc -c | tr -d ' ')" 32
t "rand_str chỉ chữ + số"             eq "$(rand_str 200 | tr -d 'A-Za-z0-9')" ""
id=$(make_id "My-Blog.example.com")
t "make_id định dạng ($id)"           valid_id "$id"
t "make_id tiền tố"                   eq "${id%-*}" "my-blog-example-com"
long=$(make_id "a-very-long-domain-name-for-testing.example.com")
t "make_id cắt ngắn (${long})"        test "${#long}" -le 29

f="$TMPROOT/x.conf"
conf_set "$f" A 1; conf_set "$f" B "x=y"; conf_set "$f" A 2
t "conf_set/get ghi đè"               eq "$(conf_get "$f" A)" 2
t "conf_get giá trị chứa ="           eq "$(conf_get "$f" B)" "x=y"
t "conf_set không trùng key"          eq "$(grep -c '^A=' "$f")" 1
t "conf_get key thiếu → rỗng"         eq "$(conf_get "$f" NOPE)" ""
t "conf_get không nhầm tiền tố"       eq "$(conf_get "$f" AB)" ""
t "conf_set tạo file mode 600"        eq "$(stat -c %a "$f")" 600

mkdir -p "$SITES_DIR/blog-com-0001"
printf 'ID=blog-com-0001\nDOMAIN=blog.com\nSSL=auto\n' >"$SITES_DIR/blog-com-0001/site.conf"
t "site_resolve theo ID"              eq "$(site_resolve blog-com-0001)" blog-com-0001
t "site_resolve theo domain"          eq "$(site_resolve blog.com)" blog-com-0001
t "site_resolve theo www + URL"       eq "$(site_resolve https://www.Blog.com/wp-admin)" blog-com-0001
t "site_resolve không tồn tại → lỗi"  not bash -c ". '$ROOT/lib/common.sh'; site_resolve nope.com"
t "domain_in_use"                     domain_in_use www.blog.com
t "domain_in_use bỏ qua chính nó"     not domain_in_use blog.com blog-com-0001

echo "== CLI"
t "dat version"                       "$ROOT/bin/dat" version
t "dat help"                          "$ROOT/bin/dat" help
t "dat add --help"                    "$ROOT/bin/dat" add --help
t "lệnh lạ → mã lỗi"                  not "$ROOT/bin/dat" khong-co-lenh-nay

echo "== docker compose config"
if docker compose version >/dev/null 2>&1; then
  W="$TMPROOT/site"; mkdir -p "$W"
  cp "$ROOT"/templates/wordpress/* "$W/"; cp "$ROOT/tests/fixtures/site.env" "$W/.env"
  t "site compose (HTTP/origin)"      docker compose --project-directory "$W" -f "$W/compose.yml" config -q
  t "site compose + Let's Encrypt"    docker compose --project-directory "$W" -f "$W/compose.yml" -f "$W/compose.le.yml" config -q
  t "site compose profile tools (cli)" docker compose --project-directory "$W" -f "$W/compose.yml" --profile tools config -q
  cfg=$(docker compose --project-directory "$W" -f "$W/compose.yml" -f "$W/compose.le.yml" config 2>/dev/null)
  t "LETSENCRYPT_HOST = VIRTUAL_HOST" grep -q 'LETSENCRYPT_HOST: test.com,www.test.com' <<<"$cfg"
  t "WP_REDIS_PREFIX theo SITE_ID"    grep -q "WP_REDIS_PREFIX', 'test-com-ab12:'" <<<"$cfg"
  t "db/redis không ra network proxy" bash -c "docker compose --project-directory '$W' -f '$W/compose.yml' config --format json \
      | python3 -c 'import json,sys; s=json.load(sys.stdin)[\"services\"]; assert set(s[\"db\"][\"networks\"])=={\"backend\"} and set(s[\"redis\"][\"networks\"])=={\"backend\"} and set(s[\"php\"][\"networks\"])=={\"backend\"}'"
  t "proxy compose"                   docker compose -f "$ROOT/proxy/compose.yml" --env-file "$ROOT/tests/fixtures/proxy.env" config -q
else
  echo "  (bỏ qua: chưa có docker compose)"
fi

echo
echo "Kết quả: $PASS đạt, $FAIL lỗi"
(( FAIL == 0 ))
