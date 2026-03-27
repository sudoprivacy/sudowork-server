# API 文档
测试地址 http://10.0.1.8:3000
测试账户 sudowork 密码 sudowork
Token: 7Rbb+omsFuRRIGEfhjpf5ESlRNhlkcq0
**鉴权说明**:
以下接口均支持通过 Access Token 进行鉴权。请在请求头中添加 `Authorization: Bearer <your_access_token>`。Access Token 可以通过系统生成。

## 1. 令牌接口 (Token Interface)

**接口路径**: `/api/token/`

该接口支持通过不同的 HTTP 方法对令牌进行获取、创建和更新操作。

### 1.1 获取所有令牌 (Get All Tokens)

获取当前用户的令牌列表。

- **URL**: `/api/token/`
- **Method**: `GET`
- **Auth**: User Auth
- **Query Parameters**:
  - `page` (int, optional): 页码，默认为 1。
  - `page_size` (int, optional): 每页数量，默认为 10。

- **Response**:
  ```json
  {
    "success": true,
    "message": "",
    "data": {
      "page": 1,
      "page_size": 10,
      "total": 1,
      "items": [
        {
          "id": 1,
          "user_id": 1,
          "key": "sk-...",
          "status": 1,
          "name": "Test Token",
          "created_time": 1678888888,
          "accessed_time": 1678888888,
          "expired_time": -1,
          "remain_quota": 500000,
          "unlimited_quota": true,
          "model_limits_enabled": false,
          "model_limits": "",
          "allow_ips": "",
          "used_quota": 0,
          "group": ""
        }
      ]
    }
  }
  ```

### 1.2 创建令牌 (Create Token)

创建一个新的令牌。

- **URL**: `/api/token/`
- **Method**: `POST`
- **Auth**: User Auth
- **Body Parameters** (JSON):
  - `name` (string, required): 令牌名称 (最多 30 字符)。
  - `expired_time` (int64, optional): 过期时间戳 (秒)，-1 表示永不过期。
  - `remain_quota` (int, optional): 剩余额度。
  - `unlimited_quota` (bool, optional): 是否无限额度。
  - `model_limits_enabled` (bool, optional): 是否启用模型限制。
  - `model_limits` (string, optional): 允许的模型列表，逗号分隔。
  - `allow_ips` (string, optional): 允许的 IP 列表，换行分隔。
  - `group` (string, optional): 分组。
  - `user_id` (int, optional): 目标用户 ID (仅管理员可用，用于为指定用户创建令牌)。

- **Response**:
  ```json
  {
    "data": {
      "id": 26,
      "user_id": 15,
      "key": "BNrCkG1OnGBLtlMwyEPZavy0yKohrXmzpdPbhBdoQC9HleGF",
      "status": 1,
      "name": "foo1's key 2",
      "created_time": 1774487628,
      "accessed_time": 1774487628,
      "expired_time": -1,
      "remain_quota": 0,
      "unlimited_quota": false,
      "model_limits_enabled": false,
      "model_limits": "",
      "allow_ips": "",
      "used_quota": 0,
      "group": "",
      "DeletedAt": null
    },
    "message": "",
    "success": true
  }
  ```

### 1.3 更新令牌 (Update Token)

更新现有的令牌信息。

- **URL**: `/api/token/`
- **Method**: `PUT`
- **Auth**: User Auth
- **Query Parameters**:
  - `status_only` (string, optional): 如果非空，则仅更新状态 (启用/禁用)。

- **Body Parameters** (JSON):
  - `id` (int, required): 令牌 ID。
  - `status` (int, optional): 状态 (1: 启用, 2: 禁用, 3: 过期, 4: 耗尽)。
  - `name` (string, optional): 令牌名称。
  - `expired_time` (int64, optional): 过期时间。
  - `remain_quota` (int, optional): 剩余额度。
  - `unlimited_quota` (bool, optional): 是否无限额度。
  - `model_limits_enabled` (bool, optional): 是否启用模型限制。
  - `model_limits` (string, optional): 模型限制列表。
  - `allow_ips` (string, optional): 允许 IP。
  - `group` (string, optional): 分组。

- **Response**:
  ```json
  {
    "success": true,
    "message": "",
    "data": {
      // 更新后的 Token 对象
    }
  }
  ```

---

## 2. 用户接口 (User Interface)

**接口路径**: `/api/user`

### 2.1 创建用户 (Create User)

管理员创建一个新用户。

- **URL**: `/api/user/`
- **Method**: `POST`
- **Auth**: Admin Auth (仅管理员可用)
- **Body Parameters** (JSON):
  - `username` (string, required): 用户名。不能重复
  - `password` (string, required): 密码 (长度 8-20)。
  - `display_name` (string, optional): 显示名称，默认同用户名。
  - `role` (int, optional): 角色 (1: 普通用户, 10: 管理员)，默认为 1。注意：无法创建权限大于或等于自己的用户。
  - `utm_source` (string,required):  固定传 "sudowork",用于sudorouter区分用户
- **Response**:
  ```json
  {
    "success": true,
    "message": "",
    "data": {
      "id": 123,
      "username": "new_user"
    }
  }
  ```

### 2.2 更新用户额度 (Update User Quota)

管理员更新特定用户的额度（充值或扣费）。

**额度说明**:

- 1 美元 ($1.00) = 500,000 quota
- 1 quota = $0.000002

- **URL**: `/api/user/quota`
- **Method**: `PUT`
- **Auth**: Admin Auth (仅管理员可用)
- **Body Parameters** (JSON):
  - `id` (int, required): 用户 ID。
  - `quota` (int, required): 变动的额度值（正数增加，负数减少）。
  - `comment` (string, optional): 备注信息，用于记录日志。

- **Response**:
  ```json
  {
    "success": true,
    "message": ""
  }
  ```
