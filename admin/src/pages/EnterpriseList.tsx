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
  Upload,
  Image,
} from "antd";
import { PlusOutlined, DeleteOutlined, EditOutlined, UploadOutlined, CloseCircleOutlined } from "@ant-design/icons";
import { adminApi } from "../api";

const { Title } = Typography;

interface Enterprise {
  id: number;
  name: string;
  code: string;
  userCount: number;
  logo?: string | null;
  app_name?: string | null;
  top_name?: string | null;
  about_name?: string | null;
  app_company_name?: string | null;
  login_desp?: string | null;
}

const DEFAULT_LOGO_URL = '/enterprise-default-logo.svg';

function getLogoUrl(logo: string | null | undefined): string {
  if (logo) {
    return `/uploads/enterprises/${logo}`;
  }
  return DEFAULT_LOGO_URL;
}

const EnterpriseList: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [visible, setVisible] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form] = Form.useForm();
  const [logoFilename, setLogoFilename] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);

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
      const submitData = { ...values, logo: logoFilename };
      const response = await adminApi.createEnterprise(submitData);
      if ((response as any).success) {
        message.success("创建成功");
        setVisible(false);
        form.resetFields();
        setLogoFilename(null);
        loadEnterprises();
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "创建失败");
    }
  };

  const handleUpdate = async (values: any) => {
    if (!editingId) return;
    try {
      const submitData = { ...values, logo: logoFilename };
      const response = await adminApi.updateEnterprise(editingId, submitData);
      if ((response as any).success) {
        message.success("更新成功");
        setVisible(false);
        setEditingId(null);
        form.resetFields();
        setLogoFilename(null);
        loadEnterprises();
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "更新失败");
    }
  };

  const openCreateModal = () => {
    setEditingId(null);
    form.resetFields();
    setLogoFilename(null);
    setVisible(true);
  };

  const openEditModal = (record: Enterprise) => {
    setEditingId(record.id);
    form.setFieldsValue({
      name: record.name,
      code: record.code,
      app_name: record.app_name,
      top_name: record.top_name,
      about_name: record.about_name,
      app_company_name: record.app_company_name,
      login_desp: record.login_desp,
    });
    setLogoFilename(record.logo);
    setVisible(true);
  };

  const handleLogoUpload = async (file: File) => {
    const validTypes = ['image/svg+xml', 'image/png', 'image/jpeg'];
    if (!validTypes.includes(file.type)) {
      message.error('仅支持 SVG、PNG、JPG 格式的图片');
      return Upload.LIST_IGNORE;
    }
    if (file.size > 500 * 1024) {
      message.error('文件大小不能超过 500KB');
      return Upload.LIST_IGNORE;
    }

    setLogoUploading(true);
    try {
      const res: any = await adminApi.uploadEnterpriseLogo(file);
      if (res.success) {
        setLogoFilename(res.data.filename);
        message.success('Logo上传成功');
      } else {
        message.error(res.msg || 'Logo上传失败');
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || 'Logo上传失败');
    } finally {
      setLogoUploading(false);
    }
    return false;
  };

  const handleDeleteLogo = () => {
    setLogoFilename(null);
    message.success('Logo已删除');
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
          setLogoFilename(null);
        }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={editingId ? handleUpdate : handleCreate}
        >
          <Form.Item label="企业Logo">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Upload
                accept=".svg,.png,.jpg,.jpeg"
                showUploadList={false}
                beforeUpload={handleLogoUpload}
                disabled={logoUploading}
              >
                <Button icon={<UploadOutlined />} loading={logoUploading}>
                  {logoFilename ? '更换Logo' : '上传Logo'}
                </Button>
              </Upload>
              {logoFilename && (
                <>
                  <Image
                    src={getLogoUrl(logoFilename)}
                    alt="企业Logo"
                    width={60}
                    height={60}
                    style={{ objectFit: 'contain', borderRadius: 4 }}
                    preview={{ mask: "查看原图" }}
                  />
                  <Button
                    type="text"
                    danger
                    icon={<CloseCircleOutlined />}
                    onClick={handleDeleteLogo}
                    title="删除Logo"
                  />
                </>
              )}
              {!logoFilename && (
                <Image
                  src={DEFAULT_LOGO_URL}
                  alt="默认Logo"
                  width={60}
                  height={60}
                  style={{ objectFit: 'contain', borderRadius: 4, opacity: 0.5 }}
                  preview={false}
                />
              )}
            </div>
          </Form.Item>
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
          <Form.Item
            label="App-Name"
            name="app_name"
          >
            <Input placeholder="请输入App-Name" />
          </Form.Item>
          <Form.Item
            label="Top-Name"
            name="top_name"
          >
            <Input placeholder="请输入Top-Name" />
          </Form.Item>
          <Form.Item
            label="About-Name"
            name="about_name"
          >
            <Input placeholder="请输入About-Name" />
          </Form.Item>
          <Form.Item
            label="APP主体名称"
            name="app_company_name"
          >
            <Input placeholder="请输入APP主体名称" />
          </Form.Item>
          <Form.Item
            label="登录页描述"
            name="login_desp"
          >
            <Input placeholder="请输入登录页描述" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default EnterpriseList;