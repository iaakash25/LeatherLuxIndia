#!/usr/bin/env bash
# Checks the LIVE deployment from the outside: HTTPS, security headers, CORS, certificate. Run it from any computer with curl and openssl
# (Git Bash on Windows is fine), after every deploy:   bash deploy/check-security.sh
# Override the addresses if needed:   SITES="https://example.com" API="https://api.example.com" bash deploy/check-security.sh
# Exit status 0 = every check passed.

API="${API:-https://api.leatherluxindia.com}"
SITES="${SITES:-https://leatherluxindia.com https://www.leatherluxindia.com https://leatherluxindia.in https://www.leatherluxindia.in}"
failures=0

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }
head_of() { curl -sI --max-time 20 "$@" | tr -d '\r'; }                 # response headers
status_of() { printf '%s' "$1" | head -n 1 | awk '{print $2}'; }
header_has() { printf '%s' "$1" | grep -qiE "^$2"; }
check() { if "$@" >/dev/null 2>&1; then return 0; else return 1; fi; }

echo "== Storefront"
for site in $SITES; do
  host="${site#https://}"
  h="$(head_of "$site/")"; code="$(status_of "$h")"
  if [ -z "$code" ]; then fail "$site is not reachable over HTTPS"; continue; fi
  case "$code" in
    200)
      pass "$site answers 200"
      header_has "$h" "content-security-policy:.*frame-ancestors 'none'" && pass "$host: content-security-policy" || fail "$host: content-security-policy missing or weak"
      header_has "$h" "strict-transport-security:.*max-age=[0-9]{7,}" && pass "$host: HSTS" || fail "$host: strict-transport-security missing"
      header_has "$h" "x-content-type-options: nosniff" && pass "$host: nosniff" || fail "$host: x-content-type-options missing"
      header_has "$h" "(x-frame-options: deny|content-security-policy:.*frame-ancestors 'none')" && pass "$host: cannot be framed" || fail "$host: can be framed"
      ;;
    301|302|307|308)
      loc="$(printf '%s' "$h" | grep -i '^location:' | head -n 1 | cut -d' ' -f2-)"
      case "$loc" in https://*) pass "$site redirects ($code) to $loc" ;; *) fail "$site redirects to a non-https address: $loc" ;; esac
      ;;
    *) fail "$site answered $code" ;;
  esac
  plain="$(head_of "http://$host/")"; pc="$(status_of "$plain")"
  case "$pc" in 301|302|307|308) printf '%s' "$plain" | grep -qi '^location: https://' && pass "http://$host goes to https" || fail "http://$host does not redirect to https" ;; *) fail "http://$host answered ${pc:-nothing} instead of redirecting to https" ;; esac
done

echo "== API ($API)"
h="$(head_of "$API/api/health/ready")"
[ "$(status_of "$h")" = "200" ] && pass "health check answers 200" || fail "health check did not answer 200 (got: $(status_of "$h"))"
header_has "$h" "strict-transport-security:" && pass "API: HSTS" || fail "API: strict-transport-security missing"
header_has "$h" "x-powered-by:" && fail "API: reveals x-powered-by" || pass "API: does not reveal x-powered-by"
header_has "$h" "server:.*[0-9]+\.[0-9]+" && fail "API: server header reveals a version" || pass "API: server header shows no version"
plain="$(head_of "http://${API#https://}/api/health/ready")"; pc="$(status_of "$plain")"
case "$pc" in 301|302|307|308) pass "API: http goes to https" ;; *) fail "API: http answered ${pc:-nothing} instead of redirecting" ;; esac

for site in $SITES; do
  h="$(head_of -H "Origin: $site" "$API/api/branding")"
  header_has "$h" "access-control-allow-origin: $site" && pass "CORS allows $site" || fail "CORS does not allow $site"
done
h="$(head_of -H "Origin: https://evil.example" "$API/api/branding")"
header_has "$h" "access-control-allow-origin:" && fail "CORS allows an unknown origin" || pass "CORS refuses an unknown origin"

echo "== Certificate"
for host in ${API#https://} $(printf '%s\n' $SITES | sed 's#https://##' | head -n 2); do
  end="$(echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  if [ -z "$end" ]; then fail "$host: no certificate found"; continue; fi
  days=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
  [ "$days" -ge 14 ] && pass "$host: certificate valid for $days more days" || fail "$host: certificate expires in $days days"
done

echo
if [ "$failures" -eq 0 ]; then echo "All checks passed."; else echo "$failures check(s) failed."; fi
exit "$failures"
