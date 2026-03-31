import React, { useState, useEffect } from "react";
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  DatePicker,
  Statistic,
  Row,
  Col,
  Typography,
  message,
  Descriptions,
  Spin,
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  StopOutlined,
  ReloadOutlined,
  EyeOutlined,
  AlipayCircleOutlined,
  WechatOutlined,
  DollarOutlined,
} from "@ant-design/icons";
import { adminApi } from "../api";
import dayjs from "dayjs";
import "./RechargeList.css";

const { Title } = Typography;
const { RangePicker } = DatePicker;

interface RechargeStats {
  today: {
    orders: number;
    amount_usd: number;
    amount_cny: number;
    points: number;
  };
  total: {
    orders: number;
    amount_usd: number;
    amount_cny: number;
    points: number;
    bonus: number;
    success_count: number;
    failed_count: number;
    pending_count: number;
  };
  by_payment: {
    ALIPAY: { count: number; amount_usd: number; amount_cny: number };
    WECHAT: { count: number; amount_usd: number; amount_cny: number };
  };
  daily: any[];
}

interface RechargeOrder {
  id: number;
  order_no: string;
  user_id: number;
  user_phone: string;
  user_nickname: string;
  amount_usd: number;
  amount_cny: number;
  exchange_rate: number;
  points: number;
  bonus_points: number;
  payment_method: "ALIPAY" | "WECHAT";
  status: number;
  status_text: string;
  created_at: string;
  callback_time?: string;
  remark?: string;
}

interface OrderDetail extends RechargeOrder {
  // Additional detail fields if needed
}

// 订单状态配置
const statusConfig: Record<number, { color: string; text: string; icon: React.ReactNode }> = {
  0: { color: "orange", text: "待支付", icon: <ClockCircleOutlined /> },
  1: { color: "blue", text: "已支付", icon: <CheckCircleOutlined /> },
  2: { color: "green", text: "充值成功", icon: <CheckCircleOutlined /> },
  3: { color: "red", text: "充值失败", icon: <CloseCircleOutlined /> },
  4: { color: "default", text: "已过期", icon: <StopOutlined /> },
  5: { color: "purple", text: "已退款", icon: <ReloadOutlined /> },
};

// 支付方式配置
const payTypeConfig: Record<string, { icon: React.ReactNode; color: string; text: string }> = {
  ALIPAY: { icon: <AlipayCircleOutlined />, color: "#1677FF", text: "支付宝" },
  WECHAT: { icon: <WechatOutlined />, color: "#07C160", text: "微信" },
};

const RechargeList: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [stats, setStats] = useState<RechargeStats | null>(null);
  const [orders, setOrders] = useState<RechargeOrder[]>([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<OrderDetail | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    loadStats();
    loadOrders();
  }, []);

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const response = await adminApi.getRechargeStats();
      if ((response as any).success) {
        setStats((response as any).data);
      }
    } catch (error) {
      console.error("Failed to load stats:", error);
    } finally {
      setStatsLoading(false);
    }
  };

  const loadOrders = async (params?: any) => {
    setLoading(true);
    try {
      const response = await adminApi.getRechargeOrders({
        page: pagination.current,
        page_size: pagination.pageSize,
        ...params,
      });
      if ((response as any).success) {
        setOrders((response as any).data.list || []);
        setPagination((prev) => ({
          ...prev,
          total: (response as any).data.total || 0,
        }));
      }
    } catch (error) {
      message.error("加载订单列表失败");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    const values = form.getFieldsValue();
    const params: any = { page: 1 };

    if (values.order_no) params.order_no = values.order_no;
    if (values.user_phone) params.user_phone = values.user_phone;
    if (values.status) params.status = values.status;
    if (values.date_range && values.date_range.length === 2) {
      params.start_date = values.date_range[0].format("YYYY-MM-DD");
      params.end_date = values.date_range[1].format("YYYY-MM-DD");
    }

    setPagination((prev) => ({ ...prev, current: 1 }));
    loadOrders(params);
  };

  const handleReset = () => {
    form.resetFields();
    setPagination((prev) => ({ ...prev, current: 1 }));
    loadOrders();
  };

  const handleTableChange = (pag: any) => {
    setPagination(pag);
    loadOrders({ page: pag.current, page_size: pag.pageSize });
  };

  const openDetailModal = async (orderNo: string) => {
    setDetailVisible(true);
    setDetailLoading(true);
    try {
      const response = await adminApi.getRechargeOrderDetail(orderNo);
      if ((response as any).success) {
        setCurrentOrder((response as any).data);
      }
    } catch (error) {
      message.error("加载订单详情失败");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRetry = async (orderNo: string) => {
    Modal.confirm({
      title: "确认重试",
      content: "确定要重试该订单的充值操作吗？",
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        setRetrying(true);
        try {
          const response = await adminApi.retryRechargeOrder(orderNo);
          if ((response as any).success) {
            message.success("订单重试成功");
            setDetailVisible(false);
            loadOrders();
            loadStats();
          } else {
            message.error((response as any).msg || "重试失败");
          }
        } catch (error: any) {
          message.error(error.response?.data?.msg || "重试失败");
        } finally {
          setRetrying(false);
        }
      },
    });
  };

  const columns = [
    {
      title: "订单号",
      dataIndex: "order_no",
      key: "order_no",
      width: 200,
      ellipsis: true,
      render: (val: string) => (
        <code className="font-mono text-xs" style={{ color: "#165DFF" }}>
          {val}
        </code>
      ),
    },
    {
      title: "用户",
      key: "user",
      width: 140,
      render: (_: any, record: RechargeOrder) => (
        <div>
          <div style={{ fontWeight: 500 }}>{record.user_nickname || record.user_phone}</div>
          {record.user_nickname && (
            <div style={{ fontSize: 12, color: "#86909c" }}>{record.user_phone}</div>
          )}
        </div>
      ),
    },
    {
      title: "充值金额",
      key: "amount",
      width: 140,
      render: (_: any, record: RechargeOrder) => (
        <div>
          <div style={{ color: "#165DFF", fontWeight: 600 }}>${record.amount_usd.toFixed(2)}</div>
          <div style={{ fontSize: 12, color: "#86909c" }}>¥{record.amount_cny.toFixed(2)}</div>
        </div>
      ),
    },
    {
      title: "积分",
      key: "points",
      width: 100,
      render: (_: any, record: RechargeOrder) => (
        <div>
          <div>{record.points.toLocaleString()}</div>
          {record.bonus_points > 0 && (
            <div style={{ fontSize: 12, color: "#00B42A" }}>+{record.bonus_points.toLocaleString()}</div>
          )}
        </div>
      ),
    },
    {
      title: "支付方式",
      dataIndex: "payment_method",
      key: "payment_method",
      width: 100,
      render: (val: string) => {
        const config = payTypeConfig[val] || { icon: null, color: "#666", text: val };
        return (
          <span style={{ color: config.color }}>
            {config.icon} {config.text}
          </span>
        );
      },
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (val: number) => {
        const config = statusConfig[val] || { color: "default", text: "未知" };
        return <Tag color={config.color}>{config.text}</Tag>;
      },
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      key: "created_at",
      width: 160,
      render: (val: string) => dayjs(val).format("MM-DD HH:mm:ss"),
    },
    {
      title: "操作",
      key: "action",
      width: 120,
      render: (_: any, record: RechargeOrder) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => openDetailModal(record.order_no)}
          >
            详情
          </Button>
          {record.status === 3 && (
            <Button
              type="link"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => handleRetry(record.order_no)}
            >
              重试
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="recharge-list">
      {/* 统计卡片 */}
      <Row gutter={24} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card className="stat-card" loading={statsLoading}>
            <Statistic
              title="今日充值 (美元)"
              prefix="$"
              value={stats?.today?.amount_usd?.toFixed(2) || 0}
              valueStyle={{ color: "#165DFF" }}
            />
            <div style={{ fontSize: 12, color: "#86909c", marginTop: 4 }}>
              ¥{stats?.today?.amount_cny?.toFixed(2) || 0}
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card className="stat-card" loading={statsLoading}>
            <Statistic
              title="今日笔数"
              value={stats?.today?.orders || 0}
              suffix="笔"
              valueStyle={{ color: "#00B42A" }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card className="stat-card" loading={statsLoading}>
            <Statistic
              title="累计充值 (美元)"
              prefix="$"
              value={stats?.total?.amount_usd?.toFixed(2) || 0}
              valueStyle={{ color: "#722ED1" }}
            />
            <div style={{ fontSize: 12, color: "#86909c", marginTop: 4 }}>
              ¥{stats?.total?.amount_cny?.toFixed(2) || 0}
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card className="stat-card" loading={statsLoading}>
            <Statistic
              title="待处理订单"
              value={stats?.total?.pending_count || 0}
              suffix="笔"
              valueStyle={{ color: stats?.total?.pending_count ? "#FF7D00" : "#1D2129" }}
            />
          </Card>
        </Col>
      </Row>

      {/* 筛选条件 */}
      <Card style={{ marginBottom: 24 }}>
        <Form form={form} layout="inline" className="filter-form">
          <Form.Item name="order_no">
            <Input placeholder="订单号" allowClear style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="user_phone">
            <Input placeholder="用户手机" allowClear style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="status">
            <Select placeholder="订单状态" allowClear style={{ width: 120 }}>
              <Select.Option value="0">待支付</Select.Option>
              <Select.Option value="1">已支付</Select.Option>
              <Select.Option value="2">充值成功</Select.Option>
              <Select.Option value="3">充值失败</Select.Option>
              <Select.Option value="4">已过期</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="date_range">
            <RangePicker style={{ width: 240 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button onClick={handleReset}>重置</Button>
              <Button type="primary" onClick={handleSearch}>
                查询
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {/* 订单表格 */}
      <Card>
        <Table
          columns={columns}
          dataSource={orders}
          loading={loading}
          rowKey="order_no"
          scroll={{ x: 1000 }}
          pagination={{
            ...pagination,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
          onChange={handleTableChange}
        />
      </Card>

      {/* 详情弹窗 */}
      <Modal
        title="订单详情"
        open={detailVisible}
        onCancel={() => {
          setDetailVisible(false);
          setCurrentOrder(null);
        }}
        footer={
          currentOrder?.status === 3
            ? [
                <Button key="close" onClick={() => setDetailVisible(false)}>
                  关闭
                </Button>,
                <Button
                  key="retry"
                  type="primary"
                  icon={<ReloadOutlined />}
                  loading={retrying}
                  onClick={() => handleRetry(currentOrder.order_no)}
                >
                  重试充值
                </Button>,
              ]
            : [
                <Button key="close" onClick={() => setDetailVisible(false)}>
                  关闭
                </Button>,
              ]
        }
        width={600}
      >
        {detailLoading ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <Spin />
          </div>
        ) : currentOrder ? (
          <div className="order-detail">
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="订单号" span={2}>
                <code className="font-mono text-xs">{currentOrder.order_no}</code>
              </Descriptions.Item>
              <Descriptions.Item label="用户">
                {currentOrder.user_nickname || currentOrder.user_phone}
              </Descriptions.Item>
              <Descriptions.Item label="手机号">
                {currentOrder.user_phone}
              </Descriptions.Item>
              <Descriptions.Item label="充值金额 (美元)">
                <span style={{ color: "#165DFF", fontWeight: 600 }}>
                  ${currentOrder.amount_usd?.toFixed(2)}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="充值金额 (人民币)">
                <span style={{ color: "#165DFF", fontWeight: 600 }}>
                  ¥{currentOrder.amount_cny?.toFixed(2)}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="汇率">
                {currentOrder.exchange_rate || 7.3}
              </Descriptions.Item>
              <Descriptions.Item label="充值积分">
                {currentOrder.points?.toLocaleString()} 积分
                {currentOrder.bonus_points > 0 && (
                  <span style={{ color: "#00B42A", marginLeft: 8 }}>
                    +{currentOrder.bonus_points.toLocaleString()} 赠送
                  </span>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="支付方式">
                {payTypeConfig[currentOrder.payment_method]?.text || currentOrder.payment_method}
              </Descriptions.Item>
              <Descriptions.Item label="订单状态">
                <Tag color={statusConfig[currentOrder.status]?.color}>
                  {currentOrder.status_text || statusConfig[currentOrder.status]?.text}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {dayjs(currentOrder.created_at).format("YYYY-MM-DD HH:mm:ss")}
              </Descriptions.Item>
              <Descriptions.Item label="支付时间">
                {currentOrder.callback_time
                  ? dayjs(currentOrder.callback_time).format("YYYY-MM-DD HH:mm:ss")
                  : "-"}
              </Descriptions.Item>
              {currentOrder.remark && (
                <Descriptions.Item label="备注" span={2}>
                  {currentOrder.remark}
                </Descriptions.Item>
              )}
            </Descriptions>
          </div>
        ) : null}
      </Modal>
    </div>
  );
};

export default RechargeList;