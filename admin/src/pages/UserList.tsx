import React, { useState, useEffect } from "react";
import {
  Card,
  Table,
  Button,
  Space,
  message,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Typography,
} from "antd";
import { PlusOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { adminApi } from "../api";

const { Title } = Typography;

interface User {
  id: number;
  phone: string;
  nickname: string;
  enterprise_id: number;
  enterprise_name: string;
  role: string;
  balance: number;
  quota: number;
  used_quota: number;
  status: number;
  invitation_code_id: number | null;
  invitation_code: string | null;
  sudorouter_user_id: number | null;
  sudorouter_key: string | null;
}

interface Enterprise {
  id: number;
  name: string;
}

interface InvitationCode {
  id: number;
  code: string;
}

const UserList: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [availableCodes, setAvailableCodes] = useState<InvitationCode[]>([]);
  const [visible, setVisible] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    loadUsers();
    loadEnterprises();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const response = await adminApi.getUsers();
      if ((response as any).success) {
        const allUsers = (response as any).data;
        setUsers(allUsers.filter((u: User) => u.phone !== "sudo"));
      }
    } catch (error) {
      message.error("加载失败");
    } finally {
      setLoading(false);
    }
  };

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

  const loadAvailableCodes = async (enterpriseId: number) => {
    try {
      const response = await adminApi.getAvailableInvitationCodes(enterpriseId);
      if ((response as any).success) {
        setAvailableCodes((response as any).data);
      }
    } catch (error) {
      console.error("Failed to load available codes:", error);
      setAvailableCodes([]);
    }
  };

  const handleCreate = async (values: any) => {
    try {
      const response = await adminApi.createUser({
        phone: values.phone,
        nickname: values.nickname,
        enterprise_id: values.enterprise_id,
        invitation_code_id: values.invitation_code_id,
      });
      if ((response as any).success) {
        message.success("创建成功");
        setVisible(false);
        form.resetFields();
        setAvailableCodes([]);
        loadUsers();
      } else {
        message.error((response as any).msg || "创建失败");
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.msg || error.message || "创建失败，请检查网络连接";
      message.error(errorMsg);
    }
  };

  const handleUpdate = async (values: any) => {
    if (!editingId) return;
    try {
      const response = await adminApi.updateUser(editingId, values);
      if ((response as any).success) {
        message.success("更新成功");
        setVisible(false);
        setEditingId(null);
        form.resetFields();
        loadUsers();
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "更新失败");
    }
  };

  const openCreateModal = () => {
    setEditingId(null);
    form.resetFields();
    setAvailableCodes([]);
    setVisible(true);
  };

  const openEditModal = (record: User) => {
    setEditingId(record.id);
    form.setFieldsValue({
      phone: record.phone,
      nickname: record.nickname,
      enterprise_id: record.enterprise_id,
      status: record.status,
    });
    setVisible(true);
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: "确认删除",
      content: "确定要删除该用户吗？",
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        try {
          await adminApi.deleteUser(id);
          message.success("删除成功");
          loadUsers();
        } catch (error: any) {
          message.error(error.response?.data?.msg || "删除失败");
        }
      },
    });
  };

  const handleManageUser = (id: number, action: "enable" | "disable") => {
    const actionText = action === "enable" ? "启用" : "禁用";
    Modal.confirm({
      title: `确认${actionText}`,
      content: `确定要${actionText}该用户吗？`,
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        try {
          const response = await adminApi.manageUser(id, action);
          if ((response as any).success) {
            message.success(`用户已${actionText}`);
            loadUsers();
          } else {
            message.error((response as any).msg || `${actionText}失败`);
          }
        } catch (error: any) {
          message.error(error.response?.data?.msg || `${actionText}失败`);
        }
      },
    });
  };

  const columns = [
    {
      title: "手机号",
      dataIndex: "phone",
      key: "phone",
      width: 120,
    },
    {
      title: "昵称",
      dataIndex: "nickname",
      key: "nickname",
      width: 120,
      ellipsis: true,
    },
    {
      title: "邀请码",
      dataIndex: "invitation_code",
      key: "invitation_code",
      width: 90,
      render: (val: string) => val ? <code className="font-mono text-xs">{val}</code> : "-",
    },
    {
      title: "API Key",
      dataIndex: "sudorouter_key",
      key: "sudorouter_key",
      width: 180,
      ellipsis: true,
      render: (val: string) => val ? (
        <code
          className="font-mono text-xs"
          style={{ color: "#1890ff", cursor: "pointer" }}
          onClick={() => {
            navigator.clipboard.writeText(`sk-${val}`);
            message.success("API Key 已复制");
          }}
          title="点击复制完整 Key"
        >
          sk-{val.substring(0, 20)}...
        </code>
      ) : "-",
    },
    {
      title: "积分",
      key: "points",
      width: 100,
      render: (_: any, record: User) => {
        const remainingPoints = Math.round((record.quota || 0) * 0.002);
        return <span style={{ color: "#1890ff" }}>{remainingPoints}</span>;
      },
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 80,
      render: (val: number) => {
        const statusMap: Record<number, React.ReactNode> = {
          0: <Tag color="orange">待审批</Tag>,
          1: <Tag color="green">正常</Tag>,
          2: <Tag color="red">禁用</Tag>,
        };
        return statusMap[val] || "-";
      },
    },
    {
      title: "操作",
      key: "action",
      width: 180,
      render: (_: any, record: User) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          >
            编辑
          </Button>
          {record.status === 2 ? (
            <Button
              type="link"
              size="small"
              style={{ color: "#52c41a" }}
              onClick={() => handleManageUser(record.id, "enable")}
            >
              启用
            </Button>
          ) : record.status === 1 ? (
            <Button
              type="link"
              size="small"
              style={{ color: "#faad14" }}
              onClick={() => handleManageUser(record.id, "disable")}
            >
              禁用
            </Button>
          ) : null}
          <Button
            type="link"
            size="small"
            danger
            onClick={() => handleDelete(record.id)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0 }}>
          用户管理
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          新建用户
        </Button>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={users}
          loading={loading}
          rowKey="id"
          scroll={{ x: 900 }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
        />
      </Card>

      <Modal
        title={editingId ? "编辑用户" : "新建用户"}
        open={visible}
        onOk={() => form.submit()}
        onCancel={() => {
          setVisible(false);
          setEditingId(null);
          form.resetFields();
        }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={editingId ? handleUpdate : handleCreate}
        >
          <Form.Item
            label="手机号"
            name="phone"
            rules={[{ required: true, message: "请输入手机号" }]}
          >
            <Input placeholder="请输入手机号" disabled={!!editingId} />
          </Form.Item>
          <Form.Item label="昵称" name="nickname">
            <Input placeholder="请输入昵称（默认使用手机号）" />
          </Form.Item>
          <Form.Item
            label="所属企业"
            name="enterprise_id"
            rules={[{ required: true, message: "请选择企业" }]}
          >
            <Select
              placeholder="请选择企业"
              onChange={(value) => {
                form.setFieldsValue({ invitation_code_id: undefined });
                if (value) {
                  loadAvailableCodes(value);
                } else {
                  setAvailableCodes([]);
                }
              }}
            >
              {enterprises.map((e) => (
                <Select.Option key={e.id} value={e.id}>
                  {e.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          {!editingId && (
            <Form.Item
              label="邀请码"
              name="invitation_code_id"
              rules={[{ required: true, message: "请选择邀请码" }]}
            >
              <Select placeholder="请先选择企业，再选择邀请码">
                {availableCodes.map((code) => (
                  <Select.Option key={code.id} value={code.id}>
                    {code.code}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}
          {editingId && (
            <Form.Item label="状态" name="status">
              <Select>
                <Select.Option value={0}>待审批</Select.Option>
                <Select.Option value={1}>已批准</Select.Option>
                <Select.Option value={2}>已拒绝</Select.Option>
              </Select>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
};

export default UserList;