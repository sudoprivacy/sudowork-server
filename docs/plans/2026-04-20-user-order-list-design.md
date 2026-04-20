# 用户订单列表功能设计

**日期:** 2026-04-20
**状态:** 已确认

---

## 背景

客户端用户中心需要展示用户的充值订单列表，支持查看不同状态的订单（已支付、支付中、已关闭等），并允许支付中状态的订单继续发起支付。

## 需求

1. 在用户中心 UserProfile 页面下方新增订单列表区域
2. 显示全部订单，下拉滚动浏览（不分页）
3. 订单状态用标签区分（支付中、支付成功、支付失败、已取消）
4. 支付中(status=1)的订单可继续支付
5. 继续支付时复用现有 RechargeModal 弹窗显示二维码
6. 订单过期或状态无效时提示用户并提供重新下单选项

---

## 架构设计

### 组件关系

```
UserProfile.tsx (现有)
├── 积分统计卡片
├── 今日使用统计
└── OrderList.tsx (新增)
    ├── 调用 /api/v1/recharge/list 获取订单
    └── 点击继续支付 → 调用 RechargeModal.openContinuePay(orderNo)

RechargeModal.tsx (修改)
├── 常规充值流程（选择套餐 → 创建订单 → 支付）
└── 继续支付流程（传入 orderNo → 直接获取二维码 → 支付）
```

### 文件改动

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/renderer/pages/settings/components/OrderList.tsx` | 新增 | 订单列表组件 |
| `src/renderer/pages/settings/UserProfile.tsx` | 修改 | 引入 OrderList |
| `src/renderer/pages/settings/components/RechargeModal.tsx` | 修改 | 扩展继续支付模式 |
| `src/services/RechargeService.ts` (服务端) | 修改 | payOrder 允许 PAYING 状态 |

---

## 详细设计

### 1. 服务端改动

**RechargeService.ts payOrder 方法（第 168-170 行）**

```typescript
// 原代码：
if (order.status !== ORDER_STATUS.PENDING) {
  return { success: false, error: "订单状态无效" };
}

// 改为：
if (order.status !== ORDER_STATUS.PENDING && order.status !== ORDER_STATUS.PAYING) {
  return { success: false, error: "订单状态无效" };
}
```

**原因:** 用户创建订单后关闭支付页面，订单状态为 PAYING(1)，需要允许此状态继续获取支付二维码。

### 2. OrderList 组件

**数据获取:**
- 调用 `/api/v1/recharge/list?page=1&pageSize=100` 获取全部订单
- 返回字段: order_no, amount_usd, amount_cny, points, status, status_text, payment_method, created_at

**UI 结构:**
```
┌─────────────────────────────────────────────────┐
│ 订单记录                                    共N条 │
├─────────────────────────────────────────────────┤
│ #202504200001  ¥99.00   [支付中] 支付宝  04-20   │
│                     → [继续支付] 按钮            │
├─────────────────────────────────────────────────┤
│ #202504190002  ¥199.00  [支付成功] 微信   04-19  │
├─────────────────────────────────────────────────┤
│ #202504180003  ¥50.00   [已取消]  支付宝  04-18  │
└─────────────────────────────────────────────────┘
```

**订单状态标签颜色:**
| 状态 | 值 | 标签颜色 | 操作 |
|------|---|---------|------|
| 待支付 | 0 | 橙色 | 无 |
| 支付中 | 1 | 蓝色 | 显示"继续支付"按钮 |
| 支付成功 | 2 | 绿色 | 无 |
| 支付失败 | 3 | 红色 | 无 |
| 已取消 | 5 | 灰色 | 无 |

### 3. RechargeModal 继续支付模式

**新增 Props:**
```typescript
interface RechargeModalProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess?: () => void;
  continuePayOrderNo?: string;  // 继续支付时传入
}
```

**行为:**
- 有 `continuePayOrderNo`: 直接调用 `/api/v1/recharge/pay` → 显示二维码 → 轮询状态
- 无 `continuePayOrderNo`: 保持现有流程（选择套餐 → 创建订单 → 支付）

**失败处理:**
订单过期或状态无效时:
- 显示错误提示（"订单已过期"或"订单状态无效"）
- 提供 [关闭] 和 [重新下单] 按钮
- 点击"重新下单" → 进入常规充值流程
- 刷新订单列表更新状态

---

## 支付时间限制

- 订单有效期: 30 分钟 (`RECHARGE_ORDER_EXPIRE_MINUTES`)
- 过期处理: payOrder 检查过期时自动将订单改为 CANCELLED

---

## API 依赖

| 接口 | 用途 |
|------|------|
| `/api/v1/recharge/list` | 获取用户订单列表（已有） |
| `/api/v1/recharge/pay` | 获取支付二维码（已有） |
| `/api/v1/recharge/query/:orderNo` | 查询订单状态（已有） |

---

## 测试要点

1. 订单列表正确显示全部订单
2. 支付中订单显示"继续支付"按钮
3. 继续支付成功获取二维码并完成支付
4. 过期订单继续支付时提示错误并提供重新下单
5. 已取消/已成功订单无操作按钮