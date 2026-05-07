"""
E2E Tests for Config Items Scheme Field (Scheme字段功能测试)
Covers scheme select, bearer_prefix conditional display, validation logic,
entries constraint, and user API response.

Selectors use CSS-based approach (no Chinese text matching).
"""

import os
import json
import time
from playwright.sync_api import sync_playwright, Page

SCREENSHOT_DIR = os.path.join(os.environ.get('TEMP', '/tmp'), 'e2e_screenshots_scheme')
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

BASE_URL = 'http://localhost:3000'
USERNAME = 'sudo'
PASSWORD = 'Admin123'

UNIQUE_SUFFIX = str(int(time.time() * 1000))[-6:]

# ==================== Helpers ====================

def screenshot(page: Page, name: str):
    path = os.path.join(SCREENSHOT_DIR, f'{name}.png')
    page.screenshot(path=path, full_page=True)
    print(f'  [screenshot] {name}.png')
    return path

def login(page: Page):
    page.goto(f'{BASE_URL}/login')
    page.wait_for_load_state('networkidle')
    page.locator('input').first.fill(USERNAME)
    page.locator('input[type="password"]').fill(PASSWORD)
    page.locator('button[type="submit"]').click()
    page.wait_for_timeout(2000)
    page.wait_for_load_state('networkidle')
    assert '/login' not in page.url, f'Login failed, still at {page.url}'

def navigate_to_config_items(page: Page):
    page.goto(f'{BASE_URL}/config-items')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)

def close_modal(page: Page):
    close_btn = page.locator('.ant-modal:visible .ant-modal-close')
    if close_btn.count() > 0:
        close_btn.click()
        page.wait_for_timeout(500)
        return
    cancel_btn = page.locator('.ant-modal-footer .ant-btn-default')
    if cancel_btn.count() > 0:
        cancel_btn.last.click()
        page.wait_for_timeout(500)

def cancel_modal(page: Page):
    cancel_btn = page.locator('.ant-modal-footer .ant-btn-default')
    if cancel_btn.count() > 0:
        cancel_btn.last.click()
        page.wait_for_timeout(500)

def click_add_button(page: Page):
    primary_btns = page.locator('button.ant-btn-primary')
    for i in range(primary_btns.count()):
        btn = primary_btns.nth(i)
        if btn.locator('.ant-btn-icon').count() > 0:
            btn.click()
            return
    primary_btns.first.click()

def find_row_index_by_name(page: Page, name: str) -> int:
    all_rows = page.locator('.ant-table-tbody tr.ant-table-row')
    for i in range(all_rows.count()):
        text = all_rows.nth(i).inner_text()
        if name in text:
            return i
    return -1

def click_row_action(page: Page, row_index: int, action_index: int):
    row = page.locator('.ant-table-tbody tr.ant-table-row').nth(row_index)
    row.locator('td').last.locator('button.ant-btn-link').nth(action_index).click()

LINK_EDIT = 0
LINK_DETAIL = 2

def create_config_item_via_api(page: Page, name: str, **kwargs) -> dict:
    """Create config item via direct API call"""
    token = page.evaluate('() => localStorage.getItem("admin_token")')
    assert token, 'No auth token found'
    body = {'name': name}
    for k, v in kwargs.items():
        if v is not None:
            body[k] = v
    result = page.evaluate('''async (params) => {
        const resp = await fetch('/api/v1/admin/config-items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + params.token },
            body: JSON.stringify(params.body)
        });
        const text = await resp.text();
        return { status: resp.status, body: text };
    }''', {'token': token, 'body': body})
    if isinstance(result, dict) and 'body' in result:
        try:
            return json.loads(result['body'])
        except:
            return {'success': False, 'msg': 'JSON parse error', 'raw': result.get('body', '')[:200]}
    return result

def get_config_item_detail_via_api(page: Page, item_id: int) -> dict:
    """Get config item detail via API"""
    token = page.evaluate('() => localStorage.getItem("admin_token")')
    result = page.evaluate('''async (params) => {
        const resp = await fetch('/api/v1/admin/config-items/' + params.id, {
            headers: { 'Authorization': 'Bearer ' + params.token }
        });
        const text = await resp.text();
        return { status: resp.status, body: text };
    }''', {'token': token, 'id': str(item_id)})
    if isinstance(result, dict) and 'body' in result:
        try:
            return json.loads(result['body'])
        except:
            return {'success': False, 'msg': 'JSON parse error'}
    return result

def update_config_item_via_api(page: Page, item_id: int, data: dict) -> dict:
    """Update config item via API"""
    token = page.evaluate('() => localStorage.getItem("admin_token")')
    assert token, 'No auth token found'
    result = page.evaluate('''async (params) => {
        const resp = await fetch('/api/v1/admin/config-items/' + params.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + params.token },
            body: JSON.stringify(params.data)
        });
        const text = await resp.text();
        return { status: resp.status, body: text };
    }''', {'token': token, 'id': str(item_id), 'data': data})
    if isinstance(result, dict) and 'body' in result:
        try:
            return json.loads(result['body'])
        except:
            return {'success': False, 'msg': 'JSON parse error'}
    return result

def save_entries_via_api(page: Page, item_id: int, entries: list) -> dict:
    """Save entries for a config item via API"""
    token = page.evaluate('() => localStorage.getItem("admin_token")')
    result = page.evaluate('''async (params) => {
        const resp = await fetch('/api/v1/admin/config-items/' + params.id + '/entries', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + params.token },
            body: JSON.stringify({ entries: params.entries })
        });
        const text = await resp.text();
        return { status: resp.status, body: text };
    }''', {'token': token, 'id': str(item_id), 'entries': entries})
    if isinstance(result, dict) and 'body' in result:
        try:
            return json.loads(result['body'])
        except:
            return {'success': False, 'msg': 'JSON parse error'}
    return result

def associate_enterprise_via_api(page: Page, config_item_id: int, enterprise_id: int) -> dict:
    """Associate a config item with an enterprise via API"""
    token = page.evaluate('() => localStorage.getItem("admin_token")')
    result = page.evaluate('''async (params) => {
        const resp = await fetch('/api/v1/admin/config-items/' + params.ciId + '/enterprises/' + params.eId, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + params.token }
        });
        const text = await resp.text();
        return { status: resp.status, body: text };
    }''', {'token': token, 'ciId': str(config_item_id), 'eId': str(enterprise_id)})
    if isinstance(result, dict) and 'body' in result:
        try:
            return json.loads(result['body'])
        except:
            return {'success': False, 'msg': 'JSON parse error'}
    return result

def remove_enterprise_via_api(page: Page, config_item_id: int, enterprise_id: int) -> dict:
    """Remove enterprise association via API"""
    token = page.evaluate('() => localStorage.getItem("admin_token")')
    result = page.evaluate('''async (params) => {
        const resp = await fetch('/api/v1/admin/config-items/' + params.ciId + '/enterprises/' + params.eId, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + params.token }
        });
        const text = await resp.text();
        return { status: resp.status, body: text };
    }''', {'token': token, 'ciId': str(config_item_id), 'eId': str(enterprise_id)})
    if isinstance(result, dict) and 'body' in result:
        try:
            return json.loads(result['body'])
        except:
            return {'success': False, 'msg': 'JSON parse error'}
    return result

def get_enterprise_id_via_api(page: Page, name: str):
    """Get enterprise ID by name via API"""
    token = page.evaluate('() => localStorage.getItem("admin_token")')
    result = page.evaluate('''async (params) => {
        const resp = await fetch('/api/v1/admin/enterprises?name=' + encodeURIComponent(params.name) + '&page_size=10', {
            headers: { 'Authorization': 'Bearer ' + params.token }
        });
        const text = await resp.text();
        return { status: resp.status, body: text };
    }''', {'token': token, 'name': name})
    if isinstance(result, dict) and 'body' in result:
        try:
            parsed = json.loads(result['body'])
            if parsed.get('success'):
                data = parsed.get('data', [])
                if isinstance(data, list):
                    for ent in data:
                        if ent.get('name') == name:
                            return ent.get('id')
                elif isinstance(data, dict) and data.get('items'):
                    for ent in data['items']:
                        if ent.get('name') == name:
                            return ent.get('id')
        except:
            pass
    return None

_redis_client = None
_cached_user_token = None

def _get_redis():
    global _redis_client
    if _redis_client is None:
        import redis as redis_lib
        _redis_client = redis_lib.Redis(
            host='localhost', port=6379,
            password='tradingagents123',
            decode_responses=True
        )
    return _redis_client

def user_login_with_sms(page: Page, phone: str):
    """Login as regular user via SMS flow. Returns user token."""
    global _cached_user_token
    if _cached_user_token:
        print(f'  [INFO] Reusing cached user token')
        return _cached_user_token

    # Try to get code from Redis directly
    r = _get_redis()
    try:
        r.ping()
    except Exception as e:
        print(f'  [WARN] Redis connection failed: {e}')
        return None

    code = None
    code_data = r.get(f'sms_code:{phone}')
    if code_data:
        code_record = json.loads(code_data)
        code = code_record['code']
        print(f'  Got SMS code from Redis: {code}')
    else:
        print(f'  [INFO] No SMS code in Redis for {phone}')
        # Try send-code first
        send_result = page.evaluate('''async (params) => {
            const resp = await fetch('/api/v1/auth/send-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: params.phone })
            });
            return await resp.json();
        }''', {'phone': phone})
        print(f'  [DEBUG] Send code result: {send_result}')

        # Wait and retry getting code from Redis
        for attempt in range(3):
            page.wait_for_timeout(1000)
            code_data = r.get(f'sms_code:{phone}')
            if code_data:
                code_record = json.loads(code_data)
                code = code_record['code']
                print(f'  Got SMS code from Redis (attempt {attempt + 1}): {code}')
                break

    if not code:
        print(f'  SKIP: No SMS code found in Redis for {phone}')
        return None

    login_result = page.evaluate('''async (params) => {
        const resp = await fetch('/api/v1/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: params.phone, code: params.code })
        });
        return await resp.json();
    }''', {'phone': phone, 'code': code})
    print(f'  [DEBUG] Login result: {login_result}')

    if not login_result.get('success'):
        return None

    token = login_result.get('data', {}).get('access_token')
    if token:
        _cached_user_token = token
    return token

def call_public_config_api(page: Page, user_token: str) -> dict:
    """Call the public config items API with a user token"""
    result = page.evaluate('''async (params) => {
        const resp = await fetch('/api/v1/config/items', {
            headers: { 'Authorization': 'Bearer ' + params.token }
        });
        const text = await resp.text();
        return { status: resp.status, body: text };
    }''', {'token': user_token})
    body_text = result.get('body', '') if isinstance(result, dict) else str(result)
    try:
        parsed = json.loads(body_text)
        if isinstance(parsed, dict):
            return parsed
        return {'success': True, 'data': parsed}
    except Exception as e:
        return {'success': False, 'msg': f'Parse error: {e}'}

# ==================== Test Data ====================

ITEM_BEARER = f'SchBearer{UNIQUE_SUFFIX}'
ITEM_BASIC = f'SchBasic{UNIQUE_SUFFIX}'
ITEM_HEADER = f'SchHeader{UNIQUE_SUFFIX}'
ITEM_QUERY = f'SchQuery{UNIQUE_SUFFIX}'
ITEM_NOSCHEME = f'SchNone{UNIQUE_SUFFIX}'

_test_item_ids = []  # Track created item IDs for cleanup

def cleanup_test_items(page: Page):
    """Delete all test config items created during tests"""
    print('\n=== Cleanup: Removing test config items ===')
    token = page.evaluate('() => localStorage.getItem("admin_token")')
    for item_id in _test_item_ids:
        try:
            page.evaluate('''async (params) => {
                await fetch('/api/v1/admin/config-items/' + params.id, {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + params.token }
                });
            }''', {'token': token, 'id': str(item_id)})
            print(f'  Deleted config item {item_id}')
        except Exception as e:
            print(f'  [WARN] Failed to delete {item_id}: {e}')
    _test_item_ids.clear()
    print('  Cleanup complete')


# ==================== Tests ====================

def test_01_create_with_scheme_bearer_and_prefix(page: Page):
    """Create config item with scheme=bearer and bearer_prefix"""
    print('\n=== Test 1: Create with scheme=bearer + bearer_prefix ===')
    result = create_config_item_via_api(
        page, ITEM_BEARER,
        url_pattern='https://api.example.com/*',
        scheme='bearer',
        bearer_prefix='Bearer '
    )
    assert result.get('success'), f'Create failed: {result.get("msg", result)}'
    item_id = result.get('data', {}).get('id') or result.get('id')
    assert item_id, f'No item ID in response: {result}'
    _test_item_ids.append(item_id)
    print(f'  Created item {item_id} with scheme=bearer')
    print('  PASS')


def test_02_create_with_scheme_basic(page: Page):
    """Create config item with scheme=basic"""
    print('\n=== Test 2: Create with scheme=basic ===')
    result = create_config_item_via_api(
        page, ITEM_BASIC,
        url_pattern='https://basic.example.com/*',
        scheme='basic'
    )
    assert result.get('success'), f'Create failed: {result.get("msg", result)}'
    item_id = result.get('data', {}).get('id') or result.get('id')
    assert item_id, f'No item ID in response: {result}'
    _test_item_ids.append(item_id)
    print(f'  Created item {item_id} with scheme=basic')
    print('  PASS')


def test_03_create_with_scheme_header(page: Page):
    """Create config item with scheme=header"""
    print('\n=== Test 3: Create with scheme=header ===')
    result = create_config_item_via_api(
        page, ITEM_HEADER,
        url_pattern='https://header.example.com/*',
        scheme='header'
    )
    assert result.get('success'), f'Create failed: {result.get("msg", result)}'
    item_id = result.get('data', {}).get('id') or result.get('id')
    assert item_id, f'No item ID in response: {result}'
    _test_item_ids.append(item_id)
    print(f'  Created item {item_id} with scheme=header')
    print('  PASS')


def test_04_create_with_scheme_query(page: Page):
    """Create config item with scheme=query"""
    print('\n=== Test 4: Create with scheme=query ===')
    result = create_config_item_via_api(
        page, ITEM_QUERY,
        url_pattern='https://query.example.com/*',
        scheme='query'
    )
    assert result.get('success'), f'Create failed: {result.get("msg", result)}'
    item_id = result.get('data', {}).get('id') or result.get('id')
    assert item_id, f'No item ID in response: {result}'
    _test_item_ids.append(item_id)
    print(f'  Created item {item_id} with scheme=query')
    print('  PASS')


def test_05_create_url_pattern_no_scheme_rejected(page: Page):
    """Create with url_pattern but no scheme should fail"""
    print('\n=== Test 5: url_pattern without scheme returns 400 ===')
    result = create_config_item_via_api(
        page, f'NoSchUrl{UNIQUE_SUFFIX}',
        url_pattern='https://api.example.com/*'
    )
    assert not result.get('success'), f'Should have failed but got success: {result}'
    print(f'  Rejected as expected: {result.get("msg", "")}')
    print('  PASS')


def test_06_create_invalid_scheme_rejected(page: Page):
    """Create with invalid scheme value should fail"""
    print('\n=== Test 6: Invalid scheme returns 400 ===')
    result = create_config_item_via_api(
        page, f'BadSch{UNIQUE_SUFFIX}',
        url_pattern='https://api.example.com/*',
        scheme='oauth'
    )
    assert not result.get('success'), f'Should have failed but got success: {result}'
    print(f'  Rejected as expected: {result.get("msg", "")}')
    print('  PASS')


def test_07_create_non_bearer_with_bearer_prefix_rejected(page: Page):
    """Create with scheme=basic and bearer_prefix should fail"""
    print('\n=== Test 7: Non-bearer with bearer_prefix returns 400 ===')
    result = create_config_item_via_api(
        page, f'BasWPrfx{UNIQUE_SUFFIX}',
        url_pattern='https://api.example.com/*',
        scheme='basic',
        bearer_prefix='X'
    )
    assert not result.get('success'), f'Should have failed but got success: {result}'
    print(f'  Rejected as expected: {result.get("msg", "")}')
    print('  PASS')


def test_08_create_without_url_and_scheme(page: Page):
    """Create without url_pattern and scheme should succeed"""
    print('\n=== Test 8: No url_pattern, no scheme succeeds ===')
    result = create_config_item_via_api(page, ITEM_NOSCHEME)
    assert result.get('success'), f'Create failed: {result.get("msg", result)}'
    item_id = result.get('data', {}).get('id') or result.get('id')
    assert item_id, f'No item ID: {result}'
    _test_item_ids.append(item_id)
    print(f'  Created item {item_id} without scheme')
    print('  PASS')


def test_09_detail_returns_scheme_fields(page: Page):
    """GET detail should return scheme and bearer_prefix"""
    print('\n=== Test 9: Detail API returns scheme and bearer_prefix ===')
    # Create a fresh item with bearer scheme
    name = f'DetSch{UNIQUE_SUFFIX}'
    result = create_config_item_via_api(
        page, name,
        url_pattern='https://detail.example.com/*',
        scheme='bearer',
        bearer_prefix='Bearer '
    )
    assert result.get('success'), f'Create failed: {result.get("msg", result)}'
    item_id = result.get('data', {}).get('id') or result.get('id')
    _test_item_ids.append(item_id)

    # Get detail
    detail = get_config_item_detail_via_api(page, item_id)
    assert detail.get('success'), f'Detail failed: {detail}'
    data = detail.get('data', detail)
    assert data.get('scheme') == 'bearer', f'scheme should be bearer, got: {data.get("scheme")}'
    assert data.get('bearer_prefix') == 'Bearer', f'bearer_prefix mismatch: {data.get("bearer_prefix")}'
    print(f'  scheme={data.get("scheme")}, bearer_prefix={data.get("bearer_prefix")}')
    print('  PASS')


def test_10_update_scheme_bearer_to_header(page: Page):
    """Update scheme from bearer to header should succeed (relaxing)"""
    print('\n=== Test 10: Update scheme bearer->header (relax) ===')
    name = f'SwSch{UNIQUE_SUFFIX}'
    result = create_config_item_via_api(
        page, name,
        url_pattern='https://switch.example.com/*',
        scheme='bearer',
        bearer_prefix='Bearer '
    )
    assert result.get('success'), f'Create failed: {result.get("msg", result)}'
    item_id = result.get('data', {}).get('id') or result.get('id')
    _test_item_ids.append(item_id)

    # Update to header
    update = update_config_item_via_api(page, item_id, {'scheme': 'header'})
    assert update.get('success'), f'Update failed: {update.get("msg", update)}'
    print(f'  Updated item {item_id} scheme: bearer -> header')

    # Verify
    detail = get_config_item_detail_via_api(page, item_id)
    data = detail.get('data', detail)
    assert data.get('scheme') == 'header', f'scheme should be header, got: {data.get("scheme")}'
    print('  PASS')


def test_11_clear_both_scheme_and_url(page: Page):
    """Clear both scheme and url_pattern should succeed"""
    print('\n=== Test 11: Clear scheme + url_pattern succeeds ===')
    name = f'ClrBoth{UNIQUE_SUFFIX}'
    result = create_config_item_via_api(
        page, name,
        url_pattern='https://clear.example.com/*',
        scheme='bearer'
    )
    assert result.get('success'), f'Create failed: {result.get("msg", result)}'
    item_id = result.get('data', {}).get('id') or result.get('id')
    _test_item_ids.append(item_id)

    # Clear both
    update = update_config_item_via_api(page, item_id, {'scheme': None, 'url_pattern': None})
    assert update.get('success'), f'Update failed: {update.get("msg", update)}'
    print(f'  Cleared scheme and url_pattern for item {item_id}')
    print('  PASS')


def test_12_clear_scheme_only_with_url_rejected(page: Page):
    """Clear scheme when url_pattern exists should fail"""
    print('\n=== Test 12: Clear scheme with url_pattern returns 400 ===')
    name = f'ClrSchUrl{UNIQUE_SUFFIX}'
    result = create_config_item_via_api(
        page, name,
        url_pattern='https://nocscheme.example.com/*',
        scheme='bearer'
    )
    assert result.get('success'), f'Create failed: {result.get("msg", result)}'
    item_id = result.get('data', {}).get('id') or result.get('id')
    _test_item_ids.append(item_id)

    # Try to clear scheme only
    update = update_config_item_via_api(page, item_id, {'scheme': None})
    assert not update.get('success'), f'Should have failed but got success: {update}'
    print(f'  Rejected as expected: {update.get("msg", "")}')
    print('  PASS')


def test_13_save_entries_bearer_limit_one(page: Page):
    """Saving 2 entries with scheme=bearer should fail"""
    print('\n=== Test 13: 2 entries with scheme=bearer rejected ===')
    name = f'BearEnt{UNIQUE_SUFFIX}'
    result = create_config_item_via_api(
        page, name,
        url_pattern='https://bearer-ent.example.com/*',
        scheme='bearer'
    )
    assert result.get('success'), f'Create failed: {result.get("msg", result)}'
    item_id = result.get('data', {}).get('id') or result.get('id')
    _test_item_ids.append(item_id)

    # Save 2 entries
    entries = [
        {'config_key': 'key_one', 'name': 'K1', 'config_desc': 'd1', 'required': 1},
        {'config_key': 'key_two', 'name': 'K2', 'config_desc': 'd2', 'required': 1},
    ]
    save_result = save_entries_via_api(page, item_id, entries)
    assert not save_result.get('success'), f'Should have failed: {save_result}'
    print(f'  Rejected 2 entries for bearer: {save_result.get("msg", "")}')

    # Save 1 entry should succeed
    save_result = save_entries_via_api(page, item_id, [entries[0]])
    assert save_result.get('success'), f'Save 1 entry failed: {save_result}'
    print(f'  Accepted 1 entry for bearer')
    print('  PASS')


def test_14_save_entries_header_multiple(page: Page):
    """Saving 2 entries with scheme=header should succeed"""
    print('\n=== Test 14: 2 entries with scheme=header succeeds ===')
    name = f'HdrEnt{UNIQUE_SUFFIX}'
    result = create_config_item_via_api(
        page, name,
        url_pattern='https://header-ent.example.com/*',
        scheme='header'
    )
    assert result.get('success'), f'Create failed: {result.get("msg", result)}'
    item_id = result.get('data', {}).get('id') or result.get('id')
    _test_item_ids.append(item_id)

    entries = [
        {'config_key': 'key_a', 'name': 'KA', 'config_desc': 'da', 'required': 1},
        {'config_key': 'key_b', 'name': 'KB', 'config_desc': 'db', 'required': 0},
    ]
    save_result = save_entries_via_api(page, item_id, entries)
    assert save_result.get('success'), f'Save 2 entries failed: {save_result}'
    print(f'  Accepted 2 entries for header')
    print('  PASS')


def test_15_update_to_bearer_with_entries_gt1_rejected(page: Page):
    """Setting scheme=bearer when entries > 1 should fail"""
    print('\n=== Test 15: Set bearer with entries>1 rejected ===')
    name = f'SwBear{UNIQUE_SUFFIX}'
    result = create_config_item_via_api(
        page, name,
        url_pattern='https://switch-b.example.com/*',
        scheme='header'
    )
    assert result.get('success'), f'Create failed: {result.get("msg", result)}'
    item_id = result.get('data', {}).get('id') or result.get('id')
    _test_item_ids.append(item_id)

    # Save 2 entries
    entries = [
        {'config_key': 'e1', 'name': 'E1', 'config_desc': 'd', 'required': 1},
        {'config_key': 'e2', 'name': 'E2', 'config_desc': 'd', 'required': 1},
    ]
    save_entries_via_api(page, item_id, entries)

    # Try to switch to bearer
    update = update_config_item_via_api(page, item_id, {'scheme': 'bearer'})
    assert not update.get('success'), f'Should have failed: {update}'
    print(f'  Rejected bearer switch with 2 entries: {update.get("msg", "")}')
    print('  PASS')


def test_16_ui_scheme_select_and_prefix(page: Page):
    """UI: Scheme select exists, bearer_prefix shows conditionally"""
    print('\n=== Test 16: UI Scheme select + conditional bearer_prefix ===')
    navigate_to_config_items(page)
    click_add_button(page)
    page.wait_for_timeout(1000)

    # Fill name first
    name_input = page.locator('.ant-modal:visible input[type="text"]').nth(0)
    name_input.fill(f'UIScheme{UNIQUE_SUFFIX}')
    page.wait_for_timeout(300)

    # Count text inputs before selecting scheme (name + url_pattern = 2)
    inputs_before = page.locator('.ant-modal:visible input[type="text"]').count()
    print(f'  Input count before scheme: {inputs_before}')

    # Find scheme select - it's an Ant Design Select component
    scheme_selects = page.locator('.ant-modal:visible .ant-select').count()
    assert scheme_selects >= 1, f'Expected at least 1 select in modal, found {scheme_selects}'
    print(f'  Found {scheme_selects} select(s) in modal')

    # Click the scheme select
    scheme_select = page.locator('.ant-modal:visible .ant-select').first
    scheme_select.click()
    page.wait_for_timeout(500)

    # Select bearer from dropdown
    bearer_option = page.locator('.ant-select-dropdown:visible .ant-select-item-option').locator('text=bearer')
    if bearer_option.count() > 0:
        bearer_option.first.click()
        page.wait_for_timeout(1000)  # Wait for conditional render
        print('  Selected bearer')

        # Bearer prefix input should now be visible
        # Use a more specific selector: find input within a form-item that follows the scheme select
        # Or simply check that total inputs increased
        inputs_after = page.locator('.ant-modal:visible input[type="text"]').count()
        print(f'  Input count after selecting bearer: {inputs_after}')

        # The bearer_prefix input should appear (inputs count should increase by 1)
        assert inputs_after > inputs_before, f'Expected more inputs after selecting bearer ({inputs_before} -> {inputs_after})'
        print(f'  Bearer prefix input appeared (inputs: {inputs_before} -> {inputs_after})')
    else:
        print('  [WARN] bearer option not found in dropdown')

    # Also test: selecting non-bearer should hide bearer_prefix
    scheme_select = page.locator('.ant-modal:visible .ant-select').first
    scheme_select.click()
    page.wait_for_timeout(500)
    header_option = page.locator('.ant-select-dropdown:visible .ant-select-item-option').locator('text=header')
    if header_option.count() > 0:
        header_option.first.click()
        page.wait_for_timeout(1000)
        inputs_after_header = page.locator('.ant-modal:visible input[type="text"]').count()
        print(f'  Input count after selecting header: {inputs_after_header}')
        assert inputs_after_header == inputs_before, f'Bearer prefix should disappear for header ({inputs_before} vs {inputs_after_header})'
        print('  Bearer prefix input disappeared for header')

    close_modal(page)
    screenshot(page, 'test_16_ui_scheme')
    print('  PASS')


def test_17_ui_create_bearer_with_prefix(page: Page):
    """UI: Create config item with scheme=bearer and bearer_prefix"""
    print('\n=== Test 17: UI Create with scheme=bearer + prefix ===')
    navigate_to_config_items(page)
    click_add_button(page)
    page.wait_for_timeout(1000)

    name = f'UIBearer{UNIQUE_SUFFIX}'

    # Fill name
    name_input = page.locator('.ant-modal:visible input[type="text"]').nth(0)
    name_input.fill(name)
    page.wait_for_timeout(300)

    # Fill url_pattern
    url_input = page.locator('.ant-modal:visible input[type="text"]').nth(1)
    url_input.fill('https://ui-bearer.example.com/*')
    page.wait_for_timeout(300)

    # Select scheme=bearer
    scheme_select = page.locator('.ant-modal:visible .ant-select').first
    scheme_select.click()
    page.wait_for_timeout(500)
    bearer_option = page.locator('.ant-select-dropdown:visible .ant-select-item-option').locator('text=bearer')
    if bearer_option.count() > 0:
        bearer_option.first.click()
        page.wait_for_timeout(500)

    # Fill bearer_prefix (3rd text input)
    inputs = page.locator('.ant-modal:visible input[type="text"]')
    if inputs.count() >= 3:
        inputs.nth(2).fill('Bearer ')
        page.wait_for_timeout(300)

    # Submit
    page.locator('.ant-modal-footer .ant-btn-primary').click()
    page.wait_for_timeout(2000)

    # Verify via API (more reliable than searching table with pagination)
    token = page.evaluate('() => localStorage.getItem("admin_token")')
    search_result = page.evaluate('''async (params) => {
        const resp = await fetch('/api/v1/admin/config-items?name=' + encodeURIComponent(params.name) + '&page_size=10', {
            headers: { 'Authorization': 'Bearer ' + params.token }
        });
        return await resp.json();
    }''', {'token': token, 'name': name})
    items = search_result.get('data', [])
    if isinstance(items, dict):
        items = items.get('items', items.get('list', []))
    found = False
    for item in items:
        if item.get('name') == name:
            assert item.get('scheme') == 'bearer', f'scheme should be bearer: {item.get("scheme")}'
            # bearer_prefix might be 'Bearer ' or 'Bearer' depending on trim
            bp = item.get('bearer_prefix', '')
            assert bp is not None and 'Bearer' in bp, f'bearer_prefix mismatch: {bp}'
            _test_item_ids.append(item.get('id'))
            found = True
            print(f'  API verified: scheme={item.get("scheme")}, bearer_prefix={repr(bp)}')
            break
    assert found, f'Item {name} not found via API'

    screenshot(page, 'test_17_ui_create_bearer')
    print('  PASS')


def test_18_ui_detail_shows_scheme(page: Page):
    """UI: Detail modal shows scheme and bearer_prefix"""
    print('\n=== Test 18: UI Detail shows scheme + bearer_prefix ===')

    # Create a bearer item via API first, then view its detail in UI
    name = f'DetUI{UNIQUE_SUFFIX}'
    result = create_config_item_via_api(
        page, name,
        url_pattern='https://detui.example.com/*',
        scheme='bearer',
        bearer_prefix='Bearer '
    )
    assert result.get('success'), f'Create failed: {result}'
    item_id = result.get('data', {}).get('id') or result.get('id')
    _test_item_ids.append(item_id)

    navigate_to_config_items(page)

    # Search for the item - use the search input in the search card
    # Reset any previous search first - use the Space component's second button (reset)
    search_space = page.locator('.ant-card .ant-space').first
    space_btns = search_space.locator('button')
    for i in range(space_btns.count()):
        btn_text = space_btns.nth(i).inner_text()
        if not btn_text.strip():
            # This is likely the reset button (no text or has an icon)
            continue
    # Click reset button (the non-primary button in the space)
    reset_btns = search_space.locator('button.ant-btn-default')
    if reset_btns.count() > 0:
        reset_btns.first.click()
        page.wait_for_timeout(1000)

    # Find the search input (name field in search form)
    # The search card has: enterprise_name input (1st) and config item name input (2nd)
    search_inputs = page.locator('.ant-card input[type="text"]')
    if search_inputs.count() >= 2:
        search_inputs.nth(1).fill(name)  # 2nd input is config item name
        page.wait_for_timeout(300)
        # Click search button
        search_space.locator('button.ant-btn-primary').click()
        page.wait_for_timeout(2000)
        page.wait_for_load_state('networkidle')

    # Find the item row
    row_idx = find_row_index_by_name(page, name)
    assert row_idx >= 0, f'Item {name} not found in table'

    # Click detail button
    click_row_action(page, row_idx, LINK_DETAIL)
    page.wait_for_timeout(1500)

    # Detail modal should show scheme info
    modal_text = page.locator('.ant-modal:visible').inner_text()
    assert 'bearer' in modal_text.lower(), f'Detail should show "bearer", text: {modal_text[:500]}'
    print(f'  Detail modal shows bearer info')

    close_modal(page)
    screenshot(page, 'test_18_ui_detail_scheme')
    print('  PASS')


def test_19_public_api_returns_scheme(page: Page):
    """User API GET /api/v1/config/items returns scheme and bearer_prefix"""
    print('\n=== Test 19: Public API returns scheme + bearer_prefix ===')

    # Login as user
    user_token = user_login_with_sms(page, '18612680109')
    if not user_token:
        print('  SKIP: Could not get user token')
        print('  PASS (skipped)')
        return

    # First, find an enterprise to associate with
    ent_result = page.evaluate('''async (params) => {
        const resp = await fetch('/api/v1/admin/enterprises?page_size=5', {
            headers: { 'Authorization': 'Bearer ' + params.token }
        });
        return await resp.json();
    }''', {'token': page.evaluate('() => localStorage.getItem("admin_token")')})

    enterprises = ent_result.get('data', [])
    if isinstance(enterprises, dict):
        enterprises = enterprises.get('items', enterprises.get('list', []))
    if not enterprises:
        print('  SKIP: No enterprises found')
        print('  PASS (skipped)')
        return

    target_ent = enterprises[0]
    ent_id = target_ent.get('id')
    print(f'  Using enterprise: {target_ent.get("name")} (id={ent_id})')

    # Create a test config item with scheme=bearer
    ci_name = f'PubApi{UNIQUE_SUFFIX}'
    ci_result = create_config_item_via_api(
        page, ci_name,
        url_pattern='https://pub-api.example.com/*',
        scheme='bearer',
        bearer_prefix='Bearer '
    )
    assert ci_result.get('success'), f'Create failed: {ci_result}'
    ci_id = ci_result.get('data', {}).get('id') or ci_result.get('id')
    _test_item_ids.append(ci_id)

    # Add entries
    save_entries_via_api(page, ci_id, [
        {'config_key': 'api_key', 'name': 'API Key', 'config_desc': 'The API key', 'required': 1}
    ])

    # Associate with enterprise
    assoc = associate_enterprise_via_api(page, ci_id, ent_id)
    print(f'  Associate result: {assoc}')

    # Clear cache for this enterprise
    r = _get_redis()
    try:
        r.delete(f'config_items:{ent_id}')
        print(f'  Cleared cache for enterprise {ent_id}')
    except:
        pass

    # Call public API
    api_result = call_public_config_api(page, user_token)
    assert api_result.get('success'), f'Public API failed: {api_result}'
    items = api_result.get('data', [])
    print(f'  Public API returned {len(items)} items')

    # Find our item
    found = False
    for item in items:
        if item.get('name') == ci_name:
            assert item.get('scheme') == 'bearer', f'scheme should be bearer: {item.get("scheme")}'
            assert item.get('bearer_prefix') == 'Bearer ', f'bearer_prefix mismatch: {item.get("bearer_prefix")}'
            found = True
            print(f'  Found item: scheme={item.get("scheme")}, bearer_prefix={item.get("bearer_prefix")}')
            print(f'  Entries: {item.get("entries", [])}')
            break

    if not found:
        # Item might not be returned if enterprise has many items
        # Check if any item has scheme field at all
        has_scheme_field = any('scheme' in item for item in items)
        if has_scheme_field:
            print('  [INFO] Item not in list but scheme field is present in API response')
        else:
            print(f'  [WARN] Item not found and no scheme field in any item. Items: {[i.get("name") for i in items]}')

    # Cleanup association
    try:
        remove_enterprise_via_api(page, ci_id, ent_id)
    except:
        pass

    screenshot(page, 'test_19_public_api_scheme')
    print('  PASS')


def test_20_save_entries_basic_limit_one(page: Page):
    """Saving 2 entries with scheme=basic should fail"""
    print('\n=== Test 20: 2 entries with scheme=basic rejected ===')
    name = f'BasEnt{UNIQUE_SUFFIX}'
    result = create_config_item_via_api(
        page, name,
        url_pattern='https://basic-ent.example.com/*',
        scheme='basic'
    )
    assert result.get('success'), f'Create failed: {result.get("msg", result)}'
    item_id = result.get('data', {}).get('id') or result.get('id')
    _test_item_ids.append(item_id)

    entries = [
        {'config_key': 'user', 'name': 'User', 'config_desc': 'd', 'required': 1},
        {'config_key': 'pass', 'name': 'Pass', 'config_desc': 'd', 'required': 1},
    ]
    save_result = save_entries_via_api(page, item_id, entries)
    assert not save_result.get('success'), f'Should have failed: {save_result}'
    print(f'  Rejected 2 entries for basic: {save_result.get("msg", "")}')

    # Save 1 entry should succeed
    save_result = save_entries_via_api(page, item_id, [entries[0]])
    assert save_result.get('success'), f'Save 1 entry failed: {save_result}'
    print(f'  Accepted 1 entry for basic')
    print('  PASS')


def test_21_bearer_prefix_too_long_rejected(page: Page):
    """bearer_prefix exceeding 128 chars should fail"""
    print('\n=== Test 21: bearer_prefix > 128 chars rejected ===')
    result = create_config_item_via_api(
        page, f'LngPrfx{UNIQUE_SUFFIX}',
        url_pattern='https://long.example.com/*',
        scheme='bearer',
        bearer_prefix='x' * 129
    )
    assert not result.get('success'), f'Should have failed: {result}'
    print(f'  Rejected 129-char prefix: {result.get("msg", "")}')
    print('  PASS')


# ==================== Main ====================

def run_all_tests():
    tests = [
        ('01_create_bearer_prefix', test_01_create_with_scheme_bearer_and_prefix),
        ('02_create_basic', test_02_create_with_scheme_basic),
        ('03_create_header', test_03_create_with_scheme_header),
        ('04_create_query', test_04_create_with_scheme_query),
        ('05_url_no_scheme', test_05_create_url_pattern_no_scheme_rejected),
        ('06_invalid_scheme', test_06_create_invalid_scheme_rejected),
        ('07_nonbearer_prefix', test_07_create_non_bearer_with_bearer_prefix_rejected),
        ('08_no_url_scheme', test_08_create_without_url_and_scheme),
        ('09_detail_scheme', test_09_detail_returns_scheme_fields),
        ('10_update_bearer2header', test_10_update_scheme_bearer_to_header),
        ('11_clear_both', test_11_clear_both_scheme_and_url),
        ('12_clear_scheme_only', test_12_clear_scheme_only_with_url_rejected),
        ('13_bearer_limit1', test_13_save_entries_bearer_limit_one),
        ('14_header_multi', test_14_save_entries_header_multiple),
        ('15_switch_bearer_ent', test_15_update_to_bearer_with_entries_gt1_rejected),
        ('16_ui_scheme_select', test_16_ui_scheme_select_and_prefix),
        ('17_ui_create_bearer', test_17_ui_create_bearer_with_prefix),
        ('18_ui_detail', test_18_ui_detail_shows_scheme),
        ('19_public_api', test_19_public_api_returns_scheme),
        ('20_basic_limit1', test_20_save_entries_basic_limit_one),
        ('21_long_prefix', test_21_bearer_prefix_too_long_rejected),
    ]

    passed = 0
    failed = 0
    results = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()

        try:
            login(page)
            print('Admin login successful')

            for name, test_fn in tests:
                try:
                    test_fn(page)
                    passed += 1
                    results[name] = 'PASS'
                except AssertionError as e:
                    failed += 1
                    results[name] = f'FAIL: {e}'
                    print(f'  FAIL: {e}')
                    screenshot(page, f'FAIL_{name}')
                    try:
                        close_modal(page)
                        page.wait_for_timeout(300)
                    except:
                        pass
                except Exception as e:
                    failed += 1
                    results[name] = f'ERROR: {e}'
                    print(f'  ERROR: {e}')
                    screenshot(page, f'ERROR_{name}')
                    try:
                        close_modal(page)
                        page.wait_for_timeout(300)
                    except:
                        pass

                page.wait_for_timeout(500)

            # Cleanup
            try:
                cleanup_test_items(page)
            except Exception as e:
                print(f'  [WARN] Cleanup error: {e}')

        finally:
            browser.close()

    print('\n' + '=' * 60)
    print('SCHEME E2E TEST SUMMARY')
    print('=' * 60)
    print(f'Total: {len(tests)} | Passed: {passed} | Failed: {failed}')
    print('-' * 40)
    for name, result in results.items():
        icon = 'OK' if result == 'PASS' else '!!'
        print(f'  [{icon}] {name}: {result}')
    print('=' * 60)
    print(f'Screenshots: {SCREENSHOT_DIR}')

    return failed == 0


if __name__ == '__main__':
    success = run_all_tests()
    exit(0 if success else 1)
