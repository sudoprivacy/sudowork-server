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
  InputNumber,
  Typography,
} from "antd";
import { PlusOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { adminApi } from "../api";

const { Title } = Typography;

interface Enterprise {
  id: number;
  name: string;
  code: string;
  userCount: number;
}

const EnterpriseList: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [visible, setVisible] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    loadEnterprises();
  }, []);

  const loadEnterprises = async () => {
    setLoading(true);
    try {
      const response = await adminApi.getEnterprises();
      if ((response as any).success) {
        setEnterprises((response as any).data);
      }
    } catch (error) {
      message.error("加载失败");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (values: any) => {
    try {
      const response = await adminApi.createEnterprise(values);
      if ((response as any).success) {
        message.success("创建成功");
        setVisible(false);
        form.resetFields();
        loadEnterprises();
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "创建失败");
    }
  };

  const handleUpdate = async (values: any) => {
    if (!editingId) return;
    try {
      const response = await adminApi.updateEnterprise(editingId, values);
      if ((response as any).success) {
        message.success("更新成功");
        setVisible(false);
        setEditingId(null);
        form.resetFields();
        loadEnterprises();
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "更新失败");
    }
  };

  const openCreateModal = () => {
    setEditingId(null);
    form.resetFields();
    setVisible(true);
  };

  const openEditModal = (record: Enterprise) => {
    setEditingId(record.id);
    form.setFieldsValue({
      name: record.name,
      code: record.code,
    });
    setVisible(true);
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: "确认删除",
      content: "确定要删除该企业吗？",
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        try {
          await adminApi.deleteEnterprise(id);
          message.success("删除成功");
          loadEnterprises();
        } catch (error: any) {
          message.error(error.response?.data?.msg || "删除失败");
        }
      },
    });
  };

  const columns = [
    {
      title: "企业名称",
      dataIndex: "name",
      key: "name",
    },
    {
      title: "企业码",
      dataIndex: "code",
      key: "code",
    },
    {
      title: "用户数",
      dataIndex: "userCount",
      key: "userCount",
    },
    {
      title: "操作",
      key: "action",
      render: (_: any, record: Enterprise) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          >
            编辑
          </Button>
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
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
          企业列表
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          新建企业
        </Button>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={enterprises}
          loading={loading}
          rowKey="id"
        />
      </Card>

      <Modal
        title={editingId ? "编辑企业" : "新建企业"}
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
            label="企业名称"
            name="name"
            rules={[{ required: true, message: "请输入企业名称" }]}
          >
            <Input placeholder="请输入企业名称" />
          </Form.Item>
          <Form.Item
            label="企业码"
            name="code"
            rules={[{ required: true, message: "请输入企业码" }]}
          >
            <Input
              placeholder="请输入企业码（唯一标识）"
              disabled={!!editingId}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default EnterpriseList;