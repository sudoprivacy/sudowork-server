import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { adminApi } from "../api";
import "./CreditApplications.css";

type CreditApplicationStatus =
  | "PENDING"
  | "PROCESSING"
  | "APPROVED"
  | "REJECTED"
  | "SYNC_FAILED"
  | "SYNC_UNKNOWN";

interface ICreditApplicationRecord {
  id: number;
  application_no: string;
  user_phone: string | null;
  user_nickname: string | null;
  enterprise_name: string | null;
  admin_phone: string | null;
  admin_nickname: string | null;
  requested_points: number;
  approved_points: number | null;
  reason: string | null;
  status: CreditApplicationStatus;
  admin_comment: string | null;
  created_at: string;
  reviewed_at: string | null;
  sudorouter_error: string | null;
}

interface IFilterValues {
  keyword?: string;
  status?: CreditApplicationStatus;
}

interface IApproveValues {
  approved_points: number;
  admin_comment?: string;
}

interface IRejectValues {
  admin_comment: string;
}

interface IApiResponse<T> {
  success?: boolean;
  data?: T;
  msg?: string;
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "response" in error) {
    const response = (error as { response?: { data?: { msg?: string } } }).response;
    return response?.data?.msg || fallback;
  }
  return fallback;
}

const statusMap: Record<CreditApplicationStatus, { color: string; text: string }> = {
  PENDING: { color: "orange", text: "待审批" },
  PROCESSING: { color: "blue", text: "处理中" },
  APPROVED: { color: "green", text: "已通过" },
  REJECTED: { color: "red", text: "已拒绝" },
  SYNC_FAILED: { color: "volcano", text: "同步失败" },
  SYNC_UNKNOWN: { color: "purple", text: "待人工核对" },
};

function renderText(value: string | null | undefined): string {
  const text = value?.trim();
  return text || "-";
}

function CreditApplications() {
  const [filterForm] = Form.useForm<IFilterValues>();
  const [approveForm] = Form.useForm<IApproveValues>();
  const [rejectForm] = Form.useForm<IRejectValues>();
  const [records, setRecords] = useState<ICreditApplicationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<ICreditApplicationRecord | null>(null);
  const [approveVisible, setApproveVisible] = useState(false);
  const [rejectVisible, setRejectVisible] = useState(false);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const values = filterForm.getFieldsValue();
      const response = (await adminApi.getCreditApplications({
        keyword: values.keyword,
        status: values.status,
        page: 1,
        pageSize: 100,
      })) as IApiResponse<{ list: ICreditApplicationRecord[] }>;
      if (response.success) {
        setRecords(response.data?.list || []);
        return;
      }
      message.error(response.msg || "加载积分申请失败");
    } catch (error) {
      message.error(getApiErrorMessage(error, "加载积分申请失败"));
    } finally {
      setLoading(false);
    }
  }, [filterForm]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const openApprove = (record: ICreditApplicationRecord) => {
    setCurrent(record);
    approveForm.setFieldsValue({
      approved_points: record.approved_points ?? record.requested_points,
      admin_comment: record.admin_comment ?? "",
    });
    setApproveVisible(true);
  };

  const openReject = (record: ICreditApplicationRecord) => {
    setCurrent(record);
    rejectForm.resetFields();
    setRejectVisible(true);
  };

  const submitApprove = async (values: IApproveValues) => {
    if (!current) return;
    try {
      const response = (await adminApi.approveCreditApplication(current.id, {
        approved_points: values.approved_points,
        admin_comment: values.admin_comment,
      })) as IApiResponse<unknown>;
      if (response.success) {
        message.success("审批通过");
        setApproveVisible(false);
        setCurrent(null);
        await loadRecords();
        return;
      }
      message.error(response.msg || "审批失败");
    } catch (error) {
      message.error(getApiErrorMessage(error, "审批失败"));
    }
  };

  const submitReject = async (values: IRejectValues) => {
    if (!current) return;
    try {
      const response = (await adminApi.rejectCreditApplication(
        current.id,
        values,
      )) as IApiResponse<unknown>;
      if (response.success) {
        message.success("已拒绝");
        setRejectVisible(false);
        setCurrent(null);
        await loadRecords();
        return;
      }
      message.error(response.msg || "拒绝失败");
    } catch (error) {
      message.error(getApiErrorMessage(error, "拒绝失败"));
    }
  };

  const retrySync = async (record: ICreditApplicationRecord) => {
    try {
      const response = (await adminApi.retryCreditApplicationSync(record.id)) as IApiResponse<unknown>;
      if (response.success) {
        message.success("重试同步成功");
        await loadRecords();
        return;
      }
      message.error(response.msg || "重试同步失败");
    } catch (error) {
      message.error(getApiErrorMessage(error, "重试同步失败"));
    }
  };

  const columns: ColumnsType<ICreditApplicationRecord> = [
    { title: "申请单号", dataIndex: "application_no", width: 180 },
    {
      title: "用户",
      width: 160,
      render: (_, record) => record.user_nickname || record.user_phone || "-",
    },
    { title: "企业", dataIndex: "enterprise_name", width: 140 },
    {
      title: "申请积分",
      dataIndex: "requested_points",
      width: 120,
      render: (value: number) => value.toLocaleString(),
    },
    {
      title: "审批积分",
      dataIndex: "approved_points",
      width: 120,
      render: (value: number | null) => (value ? value.toLocaleString() : "-"),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 120,
      render: (value: CreditApplicationStatus) => (
        <Tag color={statusMap[value].color}>{statusMap[value].text}</Tag>
      ),
    },
    {
      title: "操作",
      width: 160,
      render: (_, record) => (
        <Space size="small">
          {record.status === "PENDING" && (
            <>
              <Button type="link" onClick={() => openApprove(record)}>
                通过
              </Button>
              <Button type="link" danger onClick={() => openReject(record)}>
                拒绝
              </Button>
            </>
          )}
          {record.status === "SYNC_FAILED" && (
            <Button type="link" onClick={() => void retrySync(record)}>
              重试同步
            </Button>
          )}
        </Space>
      ),
    },
    { title: "申请原因", dataIndex: "reason", ellipsis: true },
    {
      title: "审批人",
      width: 150,
      render: (_, record) => renderText(record.admin_nickname || record.admin_phone),
    },
    {
      title: "审批备注",
      dataIndex: "admin_comment",
      width: 220,
      ellipsis: true,
      render: (value: string | null) => renderText(value),
    },
    {
      title: "审批时间",
      dataIndex: "reviewed_at",
      width: 170,
      render: (value: string | null) => renderText(value),
    },
    { title: "申请时间", dataIndex: "created_at", width: 170 },
  ];

  return (
    <div>
      <h2>积分申请</h2>
      <Card style={{ marginBottom: 12 }} styles={{ body: { padding: 12 } }}>
        <Form form={filterForm} layout="inline">
          <Form.Item name="keyword">
            <Input placeholder="用户/申请单号" allowClear style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="status">
            <Select placeholder="状态" allowClear style={{ width: 140 }}>
              <Select.Option value="PENDING">待审批</Select.Option>
              <Select.Option value="PROCESSING">处理中</Select.Option>
              <Select.Option value="APPROVED">已通过</Select.Option>
              <Select.Option value="REJECTED">已拒绝</Select.Option>
              <Select.Option value="SYNC_FAILED">同步失败</Select.Option>
              <Select.Option value="SYNC_UNKNOWN">待人工核对</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Space>
              <Button
                onClick={() => {
                  filterForm.resetFields();
                  void loadRecords();
                }}
              >
                重置
              </Button>
              <Button type="primary" onClick={() => void loadRecords()}>
                查询
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
      <Card styles={{ body: { padding: 0 } }}>
        <Table
          className="credit-applications-table"
          columns={columns}
          dataSource={records}
          loading={loading}
          rowKey="id"
          scroll={{ x: 1700 }}
          pagination={{ pageSize: 20 }}
        />
      </Card>
      <Modal
        title="审批通过"
        open={approveVisible}
        onOk={() => approveForm.submit()}
        onCancel={() => setApproveVisible(false)}
      >
        <Form form={approveForm} layout="vertical" onFinish={submitApprove}>
          <Form.Item
            label="发放积分"
            name="approved_points"
            rules={[{ required: true, message: "请输入发放积分" }]}
          >
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="审批备注" name="admin_comment">
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="拒绝申请"
        open={rejectVisible}
        onOk={() => rejectForm.submit()}
        onCancel={() => setRejectVisible(false)}
      >
        <Form form={rejectForm} layout="vertical" onFinish={submitReject}>
          <Form.Item
            label="拒绝原因"
            name="admin_comment"
            rules={[{ required: true, message: "请输入拒绝原因" }]}
          >
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default CreditApplications;
