# Sudorouter 接口速查

> 仅列出接口的请求格式、响应格式与请求示例。基础地址 `SUDOROUTER_BASE_URL`（默认 `http://10.0.1.8:3000`）。
>
> 除接口 9（模型列表）外，所有接口需带鉴权头：
>
> ```
> Content-Type: application/json
> Authorization: Bearer <API_TOKEN>
> New-Api-User: <ADMIN_USER_ID>
> ```

---

## 1. 创建用户

- **Method / URL**: `POST /api/user/`

**请求：**

```json
{
  "username": "13800138001",
  "password": "13800138001",
  "display_name": "13800138001",
  "role": 1,
  "utm_source": "sudowork"
}
```

**响应：**

```json
{
  "success": true,
  "message": "",
  "data": {
    "id": 18,
    "username": "13800138001"
  }
}
```

**示例：**

```bash
curl --request POST \
  --url http://10.0.1.8:3000/api/user/ \
  --header 'Authorization: Bearer <API_TOKEN>' \
  --header 'New-Api-User: 13' \
  --header 'Content-Type: application/json' \
  --data '{
    "username": "13800138001",
    "password": "13800138001",
    "display_name": "13800138001",
    "role": 1,
    "utm_source": "sudowork"
  }'
```

---

## 2. 获取用户信息

- **Method / URL**: `GET /api/user/{user_id}`

**请求：** 无 body，`user_id` 为路径参数。

**响应：**

```json
{
  "success": true,
  "message": "",
  "data": {
    "id": 18,
    "username": "13800138001",
    "display_name": "13800138001",
    "role": 1,
    "status": 1,
    "quota": 500000,
    "used_quota": 0,
    "request_count": 0,
    "group": "default"
  }
}
```

**示例：**

```bash
curl --request GET \
  --url http://10.0.1.8:3000/api/user/18 \
  --header 'Authorization: Bearer <API_TOKEN>' \
  --header 'New-Api-User: 13'
```

---

## 3. 精确查找用户

- **Method / URL**: `GET /api/user/search?keyword=&page=&page_size=`

**请求：** 无 body，查询参数 `keyword`（关键词）、`page`、`page_size`。

**响应：**

```json
{
  "success": true,
  "message": "",
  "data": {
    "items": [
      {
        "id": 18,
        "username": "13800138001",
        "status": 1,
        "quota": 500000,
        "used_quota": 0,
        "request_count": 0,
        "DeletedAt": null
      }
    ]
  }
}
```

**示例：**

```bash
curl --request GET \
  --url 'http://10.0.1.8:3000/api/user/search?keyword=13800138001&page=1&page_size=100' \
  --header 'Authorization: Bearer <API_TOKEN>' \
  --header 'New-Api-User: 13'
```

---

## 4. 更新用户额度（充值/扣费）

- **Method / URL**: `PUT /api/user/quota`

**请求：** `quota` 为变动值（正数增加，负数减少）。

```json
{
  "id": 18,
  "quota": 500000,
  "comment": "新用户注册赠送额度"
}
```

**响应：**

```json
{
  "success": true,
  "message": ""
}
```

**示例：**

```bash
curl --request PUT \
  --url http://10.0.1.8:3000/api/user/quota \
  --header 'Authorization: Bearer <API_TOKEN>' \
  --header 'New-Api-User: 13' \
  --header 'Content-Type: application/json' \
  --data '{
    "id": 18,
    "quota": 500000,
    "comment": "新用户注册赠送额度"
  }'
```

---

## 5. 启用/禁用用户

- **Method / URL**: `POST /api/user/manage`

**请求：** `action` 取 `enable` 或 `disable`。

```json
{
  "id": 18,
  "action": "disable"
}
```

**响应：**

```json
{
  "success": true,
  "message": ""
}
```

**示例：**

```bash
curl --request POST \
  --url http://10.0.1.8:3000/api/user/manage \
  --header 'Authorization: Bearer <API_TOKEN>' \
  --header 'New-Api-User: 13' \
  --header 'Content-Type: application/json' \
  --data '{ "id": 18, "action": "disable" }'
```

---

## 6. 删除用户

- **Method / URL**: `DELETE /api/user/{user_id}`

**请求：** 无 body，`user_id` 为路径参数。

**响应：** 无响应体，以 HTTP 状态码判断（`2xx` 为成功）。

**示例：**

```bash
curl --request DELETE \
  --url http://10.0.1.8:3000/api/user/18 \
  --header 'Authorization: Bearer <API_TOKEN>' \
  --header 'New-Api-User: 13'
```

---

## 7. 创建令牌

- **Method / URL**: `POST /api/token/`

**请求：** `expired_time: -1` 表示永不过期；`unlimited_quota: true` 表示不限额。

```json
{
  "name": "13800138001-token",
  "expired_time": -1,
  "unlimited_quota": true,
  "user_id": 18
}
```

**响应：**

```json
{
  "success": true,
  "message": "",
  "data": {
    "id": 26,
    "user_id": 18,
    "key": "BNrCkG1OnGBLtlMwyEPZavy0yKohrXmzpdPbhBdoQC9HleGF",
    "status": 1,
    "name": "13800138001-token",
    "created_time": 1774487628,
    "expired_time": -1,
    "remain_quota": 0,
    "unlimited_quota": true,
    "used_quota": 0
  }
}
```

**示例：**

```bash
curl --request POST \
  --url http://10.0.1.8:3000/api/token/ \
  --header 'Authorization: Bearer <API_TOKEN>' \
  --header 'New-Api-User: 13' \
  --header 'Content-Type: application/json' \
  --data '{
    "name": "13800138001-token",
    "expired_time": -1,
    "unlimited_quota": true,
    "user_id": 18
  }'
```

---

## 8. 获取使用日志

- **Method / URL**: `GET /api/log/query?user_id=&time_from=&time_to=&page_num=&page_size=&order_by=&desc=`

**请求：** 无 body，查询参数：`user_id`（必填）、`time_from`、`time_to`、`page_num`、`page_size`、`order_by`、`desc`。

**响应：**

```json
{
  "success": true,
  "message": "",
  "data": {
    "count": 100,
    "data": [
      {
        "id": 1,
        "user_id": 18,
        "created_at": 1678888888,
        "type": "",
        "model_name": "gpt-4o",
        "cost": 5000,
        "prompt_tokens": 100,
        "completion_tokens": 200,
        "duration": 1500,
        "channel_id": 1,
        "api_key_name": "13800138001-token",
        "detail": "",
        "user_name": "13800138001",
        "other": {
          "model_ratio": 1,
          "completion_ratio": 3,
          "group_ratio": 1,
          "model_price": 0,
          "cache_ratio": 0,
          "cache_tokens": 0
        }
      }
    ]
  }
}
```

**示例：**

```bash
curl --request GET \
  --url 'http://10.0.1.8:3000/api/log/query?user_id=18&time_from=1678000000&time_to=1679000000&page_num=1&page_size=100&order_by=created_at&desc=true' \
  --header 'Authorization: Bearer <API_TOKEN>' \
  --header 'New-Api-User: 13'
```

---

## 9. 获取可用模型列表

- **Method / URL**: `GET https://chat.sudorouter.ai/api/specific_pricing`
- **Auth**: 无需鉴权（独立域名）

**请求：** 无 body。

**响应：**

```json
{
  "success": true,
  "message": "",
  "data": [
    { "model_id": "gpt-4o" },
    { "model_id": "claude-opus-4-8" }
  ]
}
```

**示例：**

```bash
curl --request GET \
  --url https://chat.sudorouter.ai/api/specific_pricing
```
