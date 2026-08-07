import React, { useCallback, useEffect, useState } from "react";
import { Card, Table, Tag, Space, Button, message, Form, Input, Select } from "antd";
import type { TablePaginationConfig } from "antd";
import { ReloadOutlined, AlipayCircleOutlined, WechatOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { adminApi } from "../api";

interface RechargeRecord {
  id: number;
  type: "CLIENT" | "ADMIN";
  order_no: string | null;
  user_phone: string;
  user_nickname: string;
  points: number;
  quota: number;
  amount_cny: number | null;
  payment_method: string | null;
  admin_nickname: string | null;
  reason: string | null;
  source: "ADMIN_MANUAL" | "CREDIT_APPLICATION" | null;
  source_text: string | null;
  application_id: number | null;
  application_no: string | null;
  requested_points: number | null;
  approved_points: number | null;
  application_reason: string | null;
  admin_comment: string | null;
  created_at: string;
}

interface IRechargeRecordFilters {
  keyword?: string;
  type?: string;
  payment_method?: string;
  page?: number;
  pageSize?: number;
}

interface IRechargeRecordsResponse {
  success?: boolean;
  data?: {
    list?: RechargeRecord[];
    total?: number;
  };
}

const RechargeRecords: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<RechargeRecord[]>([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [filterForm] = Form.useForm();

  const loadRecords = useCallback(async (params?: IRechargeRecordFilters) => {
    setLoading(true);
    try {
      const response = await adminApi.getRechargeRecords({
        page: params?.page ?? 1,
        pageSize: params?.pageSize ?? 20,
        keyword: params?.keyword,
        type: params?.type,
        payment_method: params?.payment_method,
      }) as IRechargeRecordsResponse;
      if (response.success) {
        setRecords(response.data?.list || []);
        setPagination((prev) => ({
          ...prev,
          total: response.data?.total || 0,
        }));
      }
    } catch {
      message.error("加载充值记录失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFilterSearch = () => {
    const values = filterForm.getFieldsValue();
    setPagination((prev) => ({ ...prev, current: 1 }));
    loadRecords({
      page: 1,
      pageSize: pagination.pageSize,
      keyword: values.keyword,
      type: values.type,
      payment_method: values.payment_method,
    });
  };

  const handleFilterReset = () => {
    filterForm.resetFields();
    setPagination((prev) => ({ ...prev, current: 1 }));
    loadRecords({
      page: 1,
      pageSize: pagination.pageSize,
    });
  };

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const handleTableChange = (pag: TablePaginationConfig) => {
    setPagination((prev) => ({
      current: pag.current ?? prev.current,
      pageSize: pag.pageSize ?? prev.pageSize,
      total: pag.total ?? prev.total,
    }));
    const values = filterForm.getFieldsValue();
    loadRecords({
      page: pag.current,
      pageSize: pag.pageSize,
      keyword: values.keyword,
      type: values.type,
      payment_method: values.payment_method,
    });
  };

	  const typeConfig = {
	    CLIENT: { color: "blue", text: "客户端充值" },
	    ADMIN: { color: "green", text: "后台充值" },
	  };

  const sourceConfig = {
    ADMIN_MANUAL: { color: "green", text: "后台手工充值" },
    CREDIT_APPLICATION: { color: "purple", text: "积分申请审批发放" },
  };

  const payTypeConfig: Record<string, { icon: React.ReactNode; color: string; text: string }> = {
    ALIPAY: { icon: <AlipayCircleOutlined />, color: "#1677FF", text: "支付宝" },
    WECHAT: { icon: <WechatOutlined />, color: "#07C160", text: "微信" },
  };

  const columns = [
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      width: 100,
      render: (val: "CLIENT" | "ADMIN") => (
        <Tag color={typeConfig[val]?.color}>{typeConfig[val]?.text}</Tag>
      ),
    },
    {
      title: "用户",
      key: "user",
      width: 140,
      render: (_: unknown, record: RechargeRecord) => (
        <div>
          <div style={{ fontWeight: 500 }}>{record.user_nickname || record.user_phone}</div>
          {record.user_nickname && (
            <div style={{ fontSize: 12, color: "#86909c" }}>{record.user_phone}</div>
          )}
        </div>
      ),
    },
    {
      title: "充值积分",
      dataIndex: "points",
      key: "points",
      width: 100,
      render: (val: number) => <span style={{ color: "#165DFF", fontWeight: 600 }}>{val?.toLocaleString()}</span>,
    },
    {
      title: "充值额度",
      dataIndex: "quota",
      key: "quota",
      width: 100,
      render: (val: number) => val?.toLocaleString(),
    },
    {
      title: "金额(元)",
      dataIndex: "amount_cny",
      key: "amount_cny",
      width: 100,
      render: (val: number | null, record: RechargeRecord) => {
        if (record.type === "ADMIN") return "-";
        return <span style={{ color: "#165DFF" }}>¥{val?.toFixed(2)}</span>;
      },
    },
    {
      title: "支付方式",
      dataIndex: "payment_method",
      key: "payment_method",
      width: 100,
      render: (val: string | null, record: RechargeRecord) => {
        if (record.type === "ADMIN") return "-";
        const config = payTypeConfig[val || ""];
        return config ? (
          <span style={{ color: config.color }}>
            {config.icon} {config.text}
          </span>
        ) : (
          val || "-"
        );
      },
    },
    {
      title: "订单号",
      dataIndex: "order_no",
      key: "order_no",
      width: 200,
      render: (val: string | null) => {
        if (!val) return "-";
        return <code style={{ fontSize: 12, color: "#165DFF" }}>{val}</code>;
      },
    },
	    {
	      title: "操作人",
      dataIndex: "admin_nickname",
      key: "admin_nickname",
      width: 100,
      render: (val: string | null, record: RechargeRecord) => {
        if (record.type === "CLIENT") return "-";
        return val || "管理员";
      },
	    },
    {
      title: "来源",
      dataIndex: "source",
      key: "source",
      width: 170,
      render: (val: RechargeRecord["source"], record: RechargeRecord) => {
        if (record.type !== "ADMIN") return "-";
        const source = val || "ADMIN_MANUAL";
        const config = sourceConfig[source];
        return (
          <Space direction="vertical" size={0}>
            <Tag color={config.color}>{record.source_text || config.text}</Tag>
            {record.application_no && (
              <code style={{ fontSize: 12, color: "#722ed1" }}>
                {record.application_no}
              </code>
            )}
          </Space>
        );
      },
    },
	    {
	      title: "原因/备注",
	      dataIndex: "reason",
      key: "reason",
      width: 150,
      ellipsis: true,
      render: (val: string | null) => val || "-",
    },
    {
      title: "充值时间",
      dataIndex: "created_at",
      key: "created_at",
      width: 160,
      render: (val: string) => dayjs(val).format("YYYY-MM-DD HH:mm:ss"),
    },
  ];

  return (
    <div className="recharge-records">
      {/* 筛选条件 */}
      <Card style={{ marginBottom: 24 }}>
        <Form form={filterForm} layout="inline">
          <Form.Item name="keyword">
            <Input placeholder="用户手机/昵称" allowClear style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="type">
            <Select placeholder="充值类型" allowClear style={{ width: 140 }}>
              <Select.Option value="CLIENT">客户端充值</Select.Option>
              <Select.Option value="ADMIN">后台充值</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="payment_method">
            <Select placeholder="支付方式" allowClear style={{ width: 120 }}>
              <Select.Option value="ALIPAY">支付宝</Select.Option>
              <Select.Option value="WECHAT">微信</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Space>
              <Button onClick={handleFilterReset}>重置</Button>
              <Button type="primary" onClick={handleFilterSearch}>
                查询
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => {
            const values = filterForm.getFieldsValue();
            loadRecords({
              keyword: values.keyword,
              type: values.type,
              payment_method: values.payment_method,
            });
          }}>
            刷新
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={records}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={{
            ...pagination,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条记录`,
          }}
          onChange={handleTableChange}
        />
      </Card>
    </div>
  );
};

export default RechargeRecords;
