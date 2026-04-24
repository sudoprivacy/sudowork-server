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
  InputNumber,
  Alert,
  Spin,
} from "antd";
import { PlusOutlined, DeleteOutlined, EditOutlined, SyncOutlined, DollarOutlined, ExclamationCircleOutlined } from "@ant-design/icons";
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
  const [syncingUserId, setSyncingUserId] = useState<number | null>(null);
  const [form] = Form.useForm();
  const [filterForm] = Form.useForm();

  // Recharge modal state
  const [rechargeVisible, setRechargeVisible] = useState(false);
  const [rechargingUserId, setRechargingUserId] = useState<number | null>(null);
  const [recharging, setRecharging] = useState(false);
  const [rechargeForm] = Form.useForm();
  const [rechargeAmount, setRechargeAmount] = useState<number>(0);

  // Get current user role
  const userStr = localStorage.getItem("admin_user");
  let currentUser: any = {};
  try {
    currentUser = userStr ? JSON.parse(userStr) : {};
  } catch {
    currentUser = {};
  }
  const isSuperAdmin = currentUser.role === "SUPER_ADMIN";
  const isEnterpriseAdmin = currentUser.role === "ENTERPRISE_ADMIN";

  useEffect(() => {
    loadUsers();
    loadEnterprises();
  }, []);

  const loadUsers = async (params?: { keyword?: string; enterprise_id?: number; status?: number }) => {
    setLoading(true);
    try {
      const response = await adminApi.getUsers(params);
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

  const handleFilterSearch = () => {
    const values = filterForm.getFieldsValue();
    loadUsers({
      keyword: values.keyword,
      enterprise_id: values.enterprise_id,
      status: values.status,
    });
  };

  const handleFilterReset = () => {
    filterForm.resetFields();
    loadUsers();
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
      // Check if role changed
      const currentUser = users.find(u => u.id === editingId);
      if (currentUser && values.role && values.role !== currentUser.role) {
        try {
          const roleResponse = await adminApi.setUserRole(editingId, values.role);
          if (!(roleResponse as any).success) {
            message.error((roleResponse as any).msg || "角色更新失败");
            return;
          }
        } catch (error: any) {
          message.error(error.response?.data?.msg || "角色更新失败");
          return;
        }
      }

      // Update other user info
      const { role, ...updateData } = values;
      const response = await adminApi.updateUser(editingId, updateData);
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
      role: record.role,
    });
    setVisible(true);
  };

  const handleDelete = (user: User) => {
    Modal.confirm({
      title: "⚠️ 删除用户确认",
      icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
      content: (
        <div>
          <p style={{ marginBottom: 12 }}>
            您确定要删除用户「<strong>{user.nickname || user.phone}</strong>」(<strong>{user.phone}</strong>) 吗？
          </p>
          <div style={{ background: '#fffbe6', padding: 12, borderRadius: 4, border: '1px solid #ffe58f' }}>
            <p style={{ color: '#d48806', fontWeight: 'bold', marginBottom: 8 }}>⚠️ 删除后以下数据将被永久清除，无法恢复：</p>
            <ul style={{ marginLeft: 20, marginBottom: 0 }}>
              <li>用户账号信息</li>
              <li>积分余额和历史流水</li>
              <li>充值订单和记录</li>
              <li>Sudorouter API 账号</li>
              <li>已使用的邀请码</li>
            </ul>
          </div>
          <p style={{ color: '#ff4d4f', marginTop: 12 }}>请谨慎操作！</p>
        </div>
      ),
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await adminApi.deleteUser(user.id);
          message.success("删除成功，所有关联数据已清除");
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

  const handleSyncQuota = async (id: number) => {
    setSyncingUserId(id);
    try {
      const response = await adminApi.syncUserQuota(id);
      if ((response as any).success) {
        message.success("额度同步成功");
        loadUsers();
      } else {
        message.error((response as any).msg || "同步失败");
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "同步失败");
    } finally {
      setSyncingUserId(null);
    }
  };

  const openRechargeModal = (record: User) => {
    setRechargingUserId(record.id);
    setRechargeAmount(0);
    rechargeForm.resetFields();
    setRechargeVisible(true);
  };

  const handleRecharge = async (values: any) => {
    if (!rechargingUserId) return;
    setRecharging(true);
    try {
      // 1 美元 = 1000 积分
      const points = values.amount * 1000;
      const response = await adminApi.adminRecharge(rechargingUserId, {
        points,
        reason: values.reason,
        payment_reference: values.payment_reference,
      });
      if ((response as any).success) {
        const data = (response as any).data;
        Modal.success({
          title: "充值成功",
          content: (
            <div>
              <p>充值金额：${values.amount.toFixed(2)}</p>
              <p>充值积分：{data.points?.toLocaleString()}</p>
              <p>充值后余额：{data.newBalance?.toLocaleString()} 积分</p>
              <p>sudorouter 额度已同步更新</p>
            </div>
          ),
        });
        setRechargeVisible(false);
        setRechargingUserId(null);
        rechargeForm.resetFields();
        loadUsers();
      } else {
        message.error((response as any).msg || "充值失败");
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "充值失败");
    } finally {
      setRecharging(false);
    }
  };

  // 快捷金额（美元）- 与充值套餐一致
  const quickAmounts = [1, 5, 10, 20, 50];
  // 汇率
  const EXCHANGE_RATE = 7.3;

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
      width: 120,
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
          sk-{val.substring(0, 15)}...
        </code>
      ) : "-",
    },
    {
      title: "积分",
      key: "points",
      width: 80,
      render: (_: any, record: User) => {
        const remainingPoints = Math.round((record.quota || 0) * 0.002);
        const isSyncing = syncingUserId === record.id;
        return (
          <Space size="small">
            <span style={{ color: "#1890ff" }}>{remainingPoints}</span>
            {record.sudorouter_user_id && (
              <Button
                type="link"
                size="small"
                icon={<SyncOutlined spin={isSyncing} />}
                onClick={() => handleSyncQuota(record.id)}
                loading={isSyncing}
                title="同步最新额度"
                style={{ padding: 0 }}
              />
            )}
          </Space>
        );
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
      title: "角色",
      dataIndex: "role",
      key: "role",
      width: 120,
      render: (val: string, record: User) => {
        // SUPER_ADMIN cannot be changed
        if (val === "SUPER_ADMIN") {
          return <Tag color="red">超级管理员</Tag>;
        }
        return (
          <Select
            value={val}
            size="small"
            style={{ width: 100 }}
            onChange={async (newRole) => {
              try {
                const response = await adminApi.setUserRole(record.id, newRole);
                if ((response as any).success) {
                  message.success("角色更新成功");
                  loadUsers();
                } else {
                  message.error((response as any).msg || "更新失败");
                }
              } catch (error: any) {
                message.error(error.response?.data?.msg || "更新失败");
              }
            }}
          >
            <Select.Option value="USER">普通用户</Select.Option>
            <Select.Option value="ENTERPRISE_ADMIN">企业管理员</Select.Option>
          </Select>
        );
      },
    },
    {
      title: "操作",
      key: "action",
      width: 220,
      render: (_: any, record: User) => (
        <Space size="small">
          {isSuperAdmin && (
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEditModal(record)}
            >
              编辑
            </Button>
          )}
          {record.status === 1 && isSuperAdmin && (
            <Button
              type="link"
              size="small"
              icon={<DollarOutlined />}
              style={{ color: "#165DFF" }}
              onClick={() => openRechargeModal(record)}
            >
              充值
            </Button>
          )}
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
          {isSuperAdmin && (
            <Button
              type="link"
              size="small"
              danger
              onClick={() => handleDelete(record)}
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
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <Title level={2} style={{ margin: 0 }}>
          用户管理
        </Title>
        {isSuperAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
            新建用户
          </Button>
        )}
      </div>

      <Card style={{ marginBottom: 12 }} styles={{ body: { padding: 12 } }}>
        <Form form={filterForm} layout="inline">
          <Form.Item name="keyword">
            <Input placeholder="手机号/昵称" allowClear style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="enterprise_id">
            <Select placeholder="所属企业" allowClear style={{ width: 140 }}>
              {enterprises.map((e) => (
                <Select.Option key={e.id} value={e.id}>
                  {e.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="status">
            <Select placeholder="状态" allowClear style={{ width: 120 }}>
              <Select.Option value={0}>待审批</Select.Option>
              <Select.Option value={1}>正常</Select.Option>
              <Select.Option value={2}>禁用</Select.Option>
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

      <Card styles={{ body: { padding: 0 } }}>
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
          {editingId && (
            <Form.Item label="角色" name="role">
              <Select placeholder="选择用户角色">
                <Select.Option value="USER">普通用户</Select.Option>
                <Select.Option value="ENTERPRISE_ADMIN">企业管理员</Select.Option>
              </Select>
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* Recharge Modal */}
      <Modal
        title={`后台充值 - ${users.find(u => u.id === rechargingUserId)?.nickname || users.find(u => u.id === rechargingUserId)?.phone}`}
        open={rechargeVisible}
        onOk={() => rechargeForm.submit()}
        onCancel={() => {
          setRechargeVisible(false);
          setRechargingUserId(null);
          rechargeForm.resetFields();
        }}
        okText="确认充值"
        cancelText="取消"
        confirmLoading={recharging}
        width={500}
      >
        {rechargingUserId && (
          <>
            <div style={{ marginBottom: 16, color: "#86909c" }}>
              当前余额：{(() => {
                const user = users.find(u => u.id === rechargingUserId);
                return user ? Math.round((user.quota || 0) * 0.002).toLocaleString() : 0;
              })()} 积分
            </div>

            <Form
              form={rechargeForm}
              layout="vertical"
              onFinish={handleRecharge}
              onValuesChange={(changedValues) => {
                if (changedValues.amount) {
                  setRechargeAmount(changedValues.amount);
                }
              }}
            >
              <Form.Item
                label="充值金额 (美元)"
                name="amount"
                rules={[{ required: true, message: "请输入充值金额" }]}
              >
                <InputNumber
                  placeholder="请输入充值金额（美元）"
                  min={1}
                  precision={2}
                  style={{ width: "100%" }}
                  addonBefore="$"
                />
              </Form.Item>

              <div style={{ marginBottom: 16 }}>
                <span style={{ color: "#86909c", fontSize: 13 }}>快捷金额：</span>
                <Space size="small" style={{ marginLeft: 8 }}>
                  {quickAmounts.map((amount) => (
                    <Button
                      key={amount}
                      size="small"
                      onClick={() => {
                        rechargeForm.setFieldsValue({ amount });
                        setRechargeAmount(amount);
                      }}
                    >
                      ${amount}
                    </Button>
                  ))}
                </Space>
              </div>

              {rechargeAmount > 0 && (
                <div style={{ marginBottom: 16, padding: 12, background: "#f7f8fa", borderRadius: 8 }}>
                  <div style={{ color: "#86909c", fontSize: 13 }}>
                    充值金额：${rechargeAmount.toFixed(2)} = ¥{(rechargeAmount * EXCHANGE_RATE).toFixed(2)}
                  </div>
                  <div style={{ color: "#86909c", fontSize: 13, marginTop: 4 }}>
                    充值积分：{(() => {
                      const user = users.find(u => u.id === rechargingUserId);
                      const currentPoints = user ? Math.round((user.quota || 0) * 0.002) : 0;
                      const addedPoints = rechargeAmount * 1000; // $1 = 1000 points
                      return `${currentPoints.toLocaleString()} + ${addedPoints.toLocaleString()} = ${(currentPoints + addedPoints).toLocaleString()} 积分`;
                    })()}
                  </div>
                  <div style={{ color: "#86909c", fontSize: 13, marginTop: 4 }}>
                    充值后额度：{(() => {
                      const user = users.find(u => u.id === rechargingUserId);
                      const currentQuota = user?.quota || 0;
                      const addedQuota = rechargeAmount * 1000 * 500; // $1 = 1000 points, 1 point = 500 quota
                      return `${currentQuota.toLocaleString()} + ${addedQuota.toLocaleString()} = ${(currentQuota + addedQuota).toLocaleString()}`;
                    })()}
                  </div>
                </div>
              )}

              <Form.Item
                label="充值原因"
                name="reason"
                rules={[{ required: true, message: "请选择或输入充值原因" }]}
              >
                <Input placeholder="请选择或输入充值原因" />
              </Form.Item>

              <div style={{ marginBottom: 16 }}>
                <Space size="small">
                  {["线下支付", "活动赠送", "补偿充值", "其他"].map((reason) => (
                    <Button
                      key={reason}
                      size="small"
                      onClick={() => rechargeForm.setFieldsValue({ reason })}
                    >
                      {reason}
                    </Button>
                  ))}
                </Space>
              </div>

              <Form.Item label="支付参考号（可选）" name="payment_reference">
                <Input placeholder="如：微信转账单号、支付宝交易号等" />
              </Form.Item>
            </Form>

            <Alert
              type="warning"
              showIcon
              message="充值将同步更新 sudorouter 额度"
              style={{ marginTop: 16 }}
            />
          </>
        )}
      </Modal>
    </div>
  );
};

export default UserList;