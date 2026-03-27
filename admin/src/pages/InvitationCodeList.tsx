import React, { useState, useEffect } from "react";
import {
  Card,
  Table,
  Button,
  Space,
  message,
  Modal,
  Form,
  InputNumber,
  Tag,
  Typography,
  Select,
} from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { adminApi } from "../api";

const { Title } = Typography;

interface InvitationCode {
  id: number;
  code: string;
  enterprise_id: number;
  enterprise_name: string;
  status: number;
  used_by_user_id: number | null;
  used_by_phone: string | null;
  used_by_nickname: string | null;
  created_at: string;
  used_at: string | null;
}

interface Enterprise {
  id: number;
  name: string;
  code: string;
}

const InvitationCodeList: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [codes, setCodes] = useState<InvitationCode[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<number | undefined>();
  const [enterpriseFilter, setEnterpriseFilter] = useState<number | undefined>();
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createForm] = Form.useForm();

  const loadEnterprises = async () => {
    try {
      const response = await adminApi.getEnterprises();
      if ((response as any).success) {
        setEnterprises((response as any).data);
      }
    } catch (error) {
      console.error("Failed to load enterprises:", error);
    }
  };

  const loadCodes = async () => {
    setLoading(true);
    try {
      const response = await adminApi.getInvitationCodes({
        status: statusFilter,
        enterprise_id: enterpriseFilter,
        page,
        page_size: pageSize,
      });
      if ((response as any).success) {
        setCodes((response as any).data.items);
        setTotal((response as any).data.total);
      }
    } catch (error) {
      message.error("加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEnterprises();
  }, []);

  useEffect(() => {
    loadCodes();
  }, [page, pageSize, statusFilter, enterpriseFilter]);

  const handleCreate = async (values: { count: number; enterprise_id: number }) => {
    try {
      const response = await adminApi.createInvitationCodes(values.enterprise_id, values.count);
      if ((response as any).success) {
        message.success((response as any).msg || "创建成功");
        setCreateModalVisible(false);
        createForm.resetFields();
        loadCodes();
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "创建失败");
    }
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: "确认删除",
      content: "确定要删除该邀请码吗？",
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        try {
          await adminApi.deleteInvitationCode(id);
          message.success("删除成功");
          loadCodes();
        } catch (error: any) {
          message.error(error.response?.data?.msg || "删除失败");
        }
      },
    });
  };

  const columns = [
    {
      title: "邀请码",
      dataIndex: "code",
      key: "code",
      render: (val: string) => <code className="text-lg font-mono">{val}</code>,
    },
    {
      title: "所属企业",
      dataIndex: "enterprise_name",
      key: "enterprise_name",
      render: (val: string) => val || "-",
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (val: number) =>
        val === 0 ? <Tag color="green">未使用</Tag> : <Tag color="orange">已使用</Tag>,
    },
    {
      title: "使用者",
      key: "used_by",
      render: (_: any, record: InvitationCode) => {
        if (record.status === 0) return "-";
        return (
          <span>
            {record.used_by_nickname || record.used_by_phone || "-"}
          </span>
        );
      },
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      key: "created_at",
      render: (val: string) => new Date(val).toLocaleString(),
    },
    {
      title: "使用时间",
      dataIndex: "used_at",
      key: "used_at",
      render: (val: string | null) => (val ? new Date(val).toLocaleString() : "-"),
    },
    {
      title: "操作",
      key: "action",
      render: (_: any, record: InvitationCode) => (
        <Space>
          {record.status === 0 && (
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record.id)}
            >
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0 }}>
          邀请码管理
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateModalVisible(true)}
        >
          批量创建
        </Button>
      </div>

      <Card>
        <div style={{ marginBottom: 16 }}>
          <Space>
            <span>企业：</span>
            <Select
              style={{ width: 160 }}
              value={enterpriseFilter}
              onChange={(val) => {
                setEnterpriseFilter(val);
                setPage(1);
              }}
              allowClear
              placeholder="全部"
            >
              {enterprises.map((e) => (
                <Select.Option key={e.id} value={e.id}>
                  {e.name}
                </Select.Option>
              ))}
            </Select>

            <span>状态：</span>
            <Select
              style={{ width: 120 }}
              value={statusFilter}
              onChange={(val) => {
                setStatusFilter(val);
                setPage(1);
              }}
              allowClear
              placeholder="全部"
            >
              <Select.Option value={0}>未使用</Select.Option>
              <Select.Option value={1}>已使用</Select.Option>
            </Select>
          </Space>
        </div>

        <Table
          columns={columns}
          dataSource={codes}
          loading={loading}
          rowKey="id"
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </Card>

      <Modal
        title="批量创建邀请码"
        open={createModalVisible}
        onOk={() => createForm.submit()}
        onCancel={() => {
          setCreateModalVisible(false);
          createForm.resetFields();
        }}
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item
            label="选择企业"
            name="enterprise_id"
            rules={[{ required: true, message: "请选择企业" }]}
          >
            <Select placeholder="请选择企业">
              {enterprises.map((e) => (
                <Select.Option key={e.id} value={e.id}>
                  {e.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            label="创建数量"
            name="count"
            rules={[{ required: true, message: "请输入数量" }]}
            initialValue={10}
          >
            <InputNumber min={1} max={100} style={{ width: "100%" }} />
          </Form.Item>
          <p className="text-gray-500 text-sm">
            一次最多创建 100 个邀请码，每个邀请码为 6 位数字组合
          </p>
        </Form>
      </Modal>
    </div>
  );
};

export default InvitationCodeList;