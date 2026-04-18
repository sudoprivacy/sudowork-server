import React, { useState, useEffect, useCallback } from "react";
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
  Descriptions,
  Upload,
  Image,
} from "antd";
import { PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { adminApi } from "../api/index";

const { Title } = Typography;

const DEFAULT_ICON_URL = '/config-item-default.svg';

function getIconUrl(icon: string | null): string {
  if (icon) {
    return `/uploads/config-items/${icon}`;
  }
  return DEFAULT_ICON_URL;
}

// ==================== Types ====================

interface ConfigItemRecord {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  status: number;
  enterprise_count: number;
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

interface ConfigEntry {
  id: number;
  config_key: string;
  config_desc: string | null;
}

interface EnterpriseRecord {
  id: number;
  name: string | null;
  code: string;
  is_associated: number;
}

interface DetailData {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  status: number;
  created_by_name: string | null;
  created_by_id: number | null;
  updated_by_name: string | null;
  updated_by_id: number | null;
  created_at: string;
  updated_at: string;
  entries: ConfigEntry[];
  enterprises: { id: number; name: string | null; code: string }[];
}

// ==================== Component ====================

const ConfigItemList: React.FC = () => {
  // Main list state
  const [loading, setLoading] = useState(false);
  const [configItems, setConfigItems] = useState<ConfigItemRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filterForm] = Form.useForm();

  // Create/Edit modal
  const [formModalVisible, setFormModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<ConfigItemRecord | null>(null);
  const [form] = Form.useForm();
  const [formModalLoading, setFormModalLoading] = useState(false);
  const [iconFilename, setIconFilename] = useState<string | null>(null);
  const [iconUploading, setIconUploading] = useState(false);

  // Detail modal
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailData, setDetailData] = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Entries modal
  const [entriesModalVisible, setEntriesModalVisible] = useState(false);
  const [entriesItem, setEntriesItem] = useState<ConfigItemRecord | null>(null);
  const [entriesData, setEntriesData] = useState<ConfigEntry[]>([]);
  const [entriesSaving, setEntriesSaving] = useState(false);

  // Enterprise modal
  const [enterpriseModalVisible, setEnterpriseModalVisible] = useState(false);
  const [enterpriseItem, setEnterpriseItem] = useState<ConfigItemRecord | null>(null);
  const [enterpriseData, setEnterpriseData] = useState<EnterpriseRecord[]>([]);
  const [enterpriseTotal, setEnterpriseTotal] = useState(0);
  const [enterprisePage, setEnterprisePage] = useState(1);
  const [enterpriseSearchForm] = Form.useForm();

  // ==================== Data Loading ====================

  const loadConfigItems = useCallback(async (p?: number, ps?: number) => {
    setLoading(true);
    try {
      const values = filterForm.getFieldsValue();
      const res: any = await adminApi.getConfigItems({
        enterprise_name: values.enterprise_name || undefined,
        name: values.name || undefined,
        status: values.status !== undefined && values.status !== null ? values.status : undefined,
        page: p || page,
        page_size: ps || pageSize,
      });
      if (res.success) {
        setConfigItems(res.data.items || []);
        setTotal(res.data.total || 0);
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "加载配置项列表失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filterForm]);

  useEffect(() => {
    loadConfigItems();
  }, [page, pageSize]);

  // ==================== Search ====================

  const handleFilterSearch = () => {
    setPage(1);
    loadConfigItems(1, pageSize);
  };

  const handleFilterReset = () => {
    filterForm.resetFields();
    setPage(1);
    setTimeout(() => loadConfigItems(1, pageSize), 0);
  };

  // ==================== Create / Edit ====================

  const openCreateModal = () => {
    setEditingItem(null);
    form.resetFields();
    setIconFilename(null);
    setFormModalVisible(true);
  };

  const openEditModal = (record: ConfigItemRecord) => {
    setEditingItem(record);
    form.setFieldsValue({
      name: record.name,
      description: record.description,
    });
    setIconFilename(record.icon);
    setFormModalVisible(true);
  };

  const handleIconUpload = async (file: File) => {
    const validTypes = ['image/svg+xml', 'image/png', 'image/jpeg'];
    if (!validTypes.includes(file.type)) {
      message.error('仅支持 SVG、PNG、JPG 格式的图片');
      return Upload.LIST_IGNORE;
    }
    if (file.size > 500 * 1024) {
      message.error('文件大小不能超过 500KB');
      return Upload.LIST_IGNORE;
    }

    // Client-side square validation (PNG/JPG only, SVG relies on server-side)
    if (file.type !== 'image/svg+xml') {
      const isSquare = await new Promise<boolean>((resolve) => {
        const img = new window.Image();
        img.onload = () => resolve(img.naturalWidth === img.naturalHeight);
        img.onerror = () => resolve(false);
        img.src = URL.createObjectURL(file);
      });
      if (!isSquare) {
        message.error('图标必须是正方形图片（宽高比为 1:1）');
        return Upload.LIST_IGNORE;
      }
    }

    setIconUploading(true);
    try {
      const res: any = await adminApi.uploadConfigItemIcon(file);
      if (res.success) {
        setIconFilename(res.data.filename);
        message.success('图标上传成功');
      } else {
        message.error(res.msg || '图标上传失败');
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || '图标上传失败');
    } finally {
      setIconUploading(false);
    }
    return false;
  };

  const handleFormSubmit = async (values: any) => {
    setFormModalLoading(true);
    try {
      const submitData = { ...values, icon: iconFilename };
      let res: any;
      if (editingItem) {
        res = await adminApi.updateConfigItem(editingItem.id, submitData);
      } else {
        res = await adminApi.createConfigItem(submitData);
      }
      if (res.success) {
        message.success(res.msg);
        setFormModalVisible(false);
        setEditingItem(null);
        form.resetFields();
        setIconFilename(null);
        loadConfigItems();
      } else {
        message.error(res.msg || "操作失败");
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "操作失败");
    } finally {
      setFormModalLoading(false);
    }
  };

  // ==================== Toggle Status ====================

  const handleToggleStatus = (record: ConfigItemRecord, targetStatus: number) => {
    const actionText = targetStatus === 0 ? "禁用" : "恢复";
    Modal.confirm({
      title: `确认${actionText}`,
      content: targetStatus === 0
        ? `确定要禁用配置项「${record.name}」吗？禁用后将解除所有企业关联关系。`
        : `确定要恢复配置项「${record.name}」吗？`,
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        try {
          const res: any = await adminApi.updateConfigItemStatus(record.id, targetStatus);
          if (res.success) {
            message.success(res.msg);
            loadConfigItems();
          } else {
            message.error(res.msg || "操作失败");
          }
        } catch (error: any) {
          message.error(error.response?.data?.msg || "操作失败");
        }
      },
    });
  };

  // ==================== Detail ====================

  const openDetailModal = async (record: ConfigItemRecord) => {
    setDetailVisible(true);
    setDetailLoading(true);
    try {
      const res: any = await adminApi.getConfigItemDetail(record.id);
      if (res.success) {
        setDetailData(res.data);
      } else {
        message.error(res.msg || "加载详情失败");
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "加载详情失败");
    } finally {
      setDetailLoading(false);
    }
  };

  // ==================== Entries ====================

  const openEntriesModal = async (record: ConfigItemRecord) => {
    setEntriesItem(record);
    setEntriesModalVisible(true);
    try {
      const res: any = await adminApi.getConfigEntries(record.id);
      if (res.success) {
        setEntriesData(res.data || []);
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "加载配置列表失败");
    }
  };

  const handleAddEntry = () => {
    setEntriesData([...entriesData, { id: Date.now(), config_key: "", config_desc: null }]);
  };

  const handleDeleteEntry = (index: number) => {
    setEntriesData(entriesData.filter((_, i) => i !== index));
  };

  const handleEntryKeyChange = (index: number, value: string) => {
    const newData = [...entriesData];
    newData[index] = { ...newData[index], config_key: value };
    setEntriesData(newData);
  };

  const handleEntryDescChange = (index: number, value: string) => {
    const newData = [...entriesData];
    newData[index] = { ...newData[index], config_desc: value || null };
    setEntriesData(newData);
  };

  const handleSaveEntries = async () => {
    // Frontend validation
    for (let i = 0; i < entriesData.length; i++) {
      const entry = entriesData[i];
      if (!entry.config_key.trim()) {
        message.error(`第 ${i + 1} 行的配置key不能为空`);
        return;
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(entry.config_key)) {
        message.error(`第 ${i + 1} 行的配置key只允许英文字母、数字、-和_`);
        return;
      }
      if (entry.config_key.length > 128) {
        message.error(`第 ${i + 1} 行的配置key不超过128个字符`);
        return;
      }
    }
    const keys = entriesData.map((e) => e.config_key);
    const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (duplicates.length > 0) {
      message.error(`配置key「${duplicates[0]}」重复`);
      return;
    }

    setEntriesSaving(true);
    try {
      const res: any = await adminApi.saveConfigEntries(entriesItem!.id, entriesData);
      if (res.success) {
        message.success(res.msg);
        setEntriesModalVisible(false);
        setEntriesItem(null);
        loadConfigItems();
      } else {
        message.error(res.msg || "保存失败");
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "保存失败");
    } finally {
      setEntriesSaving(false);
    }
  };

  // ==================== Enterprise Association ====================

  const loadEnterprises = useCallback(async (p?: number) => {
    if (!enterpriseItem) return;
    try {
      const values = enterpriseSearchForm.getFieldsValue();
      const params: any = {
        page: p || enterprisePage,
        page_size: 20,
      };
      if (values.enterprise_name) params.enterprise_name = values.enterprise_name;
      if (values.enterprise_id) params.enterprise_id = values.enterprise_id;

      const res: any = await adminApi.getConfigEnterprises(enterpriseItem.id, params);
      if (res.success) {
        setEnterpriseData(res.data.items || []);
        setEnterpriseTotal(res.data.total || 0);
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "加载企业列表失败");
    }
  }, [enterpriseItem, enterprisePage, enterpriseSearchForm]);

  const openEnterpriseModal = (record: ConfigItemRecord) => {
    setEnterpriseItem(record);
    enterpriseSearchForm.resetFields();
    setEnterprisePage(1);
    setEnterpriseModalVisible(true);
  };

  useEffect(() => {
    if (enterpriseItem && enterpriseModalVisible) {
      loadEnterprises();
    }
  }, [enterpriseItem, enterpriseModalVisible, enterprisePage]);

  const handleEnterpriseSearch = () => {
    setEnterprisePage(1);
    setTimeout(() => loadEnterprises(1), 0);
  };

  const handleEnterpriseReset = () => {
    enterpriseSearchForm.resetFields();
    setEnterprisePage(1);
    setTimeout(() => loadEnterprises(1), 0);
  };

  const handleToggleAssociation = (record: EnterpriseRecord) => {
    const actionText = record.is_associated ? "取消关联" : "关联";
    Modal.confirm({
      title: `确认${actionText}`,
      content: `确定要${actionText}企业「${record.name}」吗？`,
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        try {
          let res: any;
          if (record.is_associated) {
            res = await adminApi.removeConfigEnterprise(enterpriseItem!.id, record.id);
          } else {
            res = await adminApi.addConfigEnterprise(enterpriseItem!.id, record.id);
          }
          if (res.success) {
            message.success(res.msg);
            loadEnterprises();
            loadConfigItems();
          } else {
            message.error(res.msg || "操作失败");
          }
        } catch (error: any) {
          message.error(error.response?.data?.msg || "操作失败");
        }
      },
    });
  };

  // ==================== Table Columns ====================

  const columns = [
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      width: 80,
    },
    {
      title: "图标",
      dataIndex: "icon",
      key: "icon",
      width: 60,
      align: "center" as const,
      render: (icon: string | null) => (
        <Image
          src={getIconUrl(icon)}
          alt="图标"
          width={32}
          height={32}
          style={{ objectFit: 'contain' }}
          preview={{ mask: "查看原图" }}
        />
      ),
    },
    {
      title: "配置项名称",
      dataIndex: "name",
      key: "name",
    },
    {
      title: "关联数量",
      dataIndex: "enterprise_count",
      key: "enterprise_count",
      width: 100,
      align: "center" as const,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 80,
      render: (val: number) =>
        val === 1 ? <Tag color="green">正常</Tag> : <Tag color="red">禁用</Tag>,
    },
    {
      title: "操作",
      key: "action",
      width: 200,
      render: (_: any, record: ConfigItemRecord) => (
        <Space direction="vertical" size={0}>
          <Space size="small">
            {record.status === 1 && (
              <Button type="link" size="small" onClick={() => openEditModal(record)}>
                编辑
              </Button>
            )}
            {record.status === 1 ? (
              <Button
                type="link"
                size="small"
                style={{ color: "#faad14" }}
                onClick={() => handleToggleStatus(record, 0)}
              >
                禁用
              </Button>
            ) : (
              <Button
                type="link"
                size="small"
                style={{ color: "#52c41a" }}
                onClick={() => handleToggleStatus(record, 1)}
              >
                恢复
              </Button>
            )}
            <Button type="link" size="small" onClick={() => openDetailModal(record)}>
              详情
            </Button>
          </Space>
          {record.status === 1 && (
            <Space size="small">
              <Button type="link" size="small" onClick={() => openEntriesModal(record)}>
                配置列表
              </Button>
              <Button type="link" size="small" onClick={() => openEnterpriseModal(record)}>
                关联企业
              </Button>
            </Space>
          )}
        </Space>
      ),
    },
  ];

  const enterpriseColumns = [
    {
      title: "企业ID",
      dataIndex: "id",
      key: "id",
      width: 100,
    },
    {
      title: "企业名称",
      dataIndex: "name",
      key: "name",
    },
    {
      title: "操作",
      key: "action",
      width: 100,
      render: (_: any, record: EnterpriseRecord) =>
        record.is_associated ? (
          <Button
            type="link"
            size="small"
            danger
            onClick={() => handleToggleAssociation(record)}
          >
            取消关联
          </Button>
        ) : (
          <Button
            type="link"
            size="small"
            style={{ color: "#165DFF" }}
            onClick={() => handleToggleAssociation(record)}
          >
            关联
          </Button>
        ),
    },
  ];

  const entryColumns = [
    {
      title: "配置key",
      dataIndex: "config_key",
      key: "config_key",
      render: (val: string, _: any, index: number) => (
        <Input
          value={val}
          placeholder="仅允许英文字母、数字、-和_"
          maxLength={128}
          onChange={(e) => handleEntryKeyChange(index, e.target.value)}
        />
      ),
    },
    {
      title: "配置说明",
      dataIndex: "config_desc",
      key: "config_desc",
      render: (val: string | null, _: any, index: number) => (
        <Input
          value={val || ""}
          placeholder="请输入配置说明"
          maxLength={500}
          onChange={(e) => handleEntryDescChange(index, e.target.value)}
        />
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 80,
      render: (_: any, __: any, index: number) => (
        <Button type="link" size="small" danger onClick={() => handleDeleteEntry(index)}>
          删除
        </Button>
      ),
    },
  ];

  // ==================== Render ====================

  return (
    <div>
      {/* Page Title */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0 }}>
          配置项列表
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          增加配置项
        </Button>
      </div>

      {/* Search Component */}
      <Card style={{ marginBottom: 24 }}>
        <Form form={filterForm} layout="inline" initialValues={{ status: 1 }}>
          <Form.Item name="enterprise_name">
            <Input placeholder="企业名称" allowClear style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="name">
            <Input placeholder="配置项名称" allowClear style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="status">
            <Select style={{ width: 120 }}>
              <Select.Option value={1}>正常</Select.Option>
              <Select.Option value={0}>禁用</Select.Option>
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

      {/* Data Table */}
      <Card>
        <Table
          columns={columns}
          dataSource={configItems}
          loading={loading}
          rowKey="id"
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </Card>

      {/* ==================== Modal 1: Create / Edit ==================== */}
      <Modal
        title={editingItem ? `${editingItem.name} - 修改配置项` : "新增配置项"}
        open={formModalVisible}
        onOk={() => form.submit()}
        onCancel={() => {
          setFormModalVisible(false);
          setEditingItem(null);
          form.resetFields();
          setIconFilename(null);
        }}
        confirmLoading={formModalLoading}
      >
        <Form form={form} layout="vertical" onFinish={handleFormSubmit}>
          <Form.Item label="配置项图标">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Upload
                accept=".svg,.png,.jpg,.jpeg"
                showUploadList={false}
                beforeUpload={handleIconUpload}
                disabled={iconUploading}
              >
                <Button icon={<UploadOutlined />} loading={iconUploading}>
                  {iconFilename ? '更换图标' : '上传图标'}
                </Button>
              </Upload>
              {iconFilename && (
                <Image
                  src={getIconUrl(iconFilename)}
                  alt="配置项图标"
                  width={40}
                  height={40}
                  style={{ objectFit: 'contain', borderRadius: 4 }}
                  preview={{ mask: "查看原图" }}
                />
              )}
              {!iconFilename && (
                <Image
                  src={DEFAULT_ICON_URL}
                  alt="默认图标"
                  width={40}
                  height={40}
                  style={{ objectFit: 'contain', borderRadius: 4, opacity: 0.5 }}
                  preview={false}
                />
              )}
            </div>
          </Form.Item>
          <Form.Item
            label="配置项名称"
            name="name"
            rules={[
              { required: true, message: "请输入配置项名称" },
              { max: 20, message: "配置项名称不超过20个字符" },
            ]}
          >
            <Input placeholder="请输入配置项名称" maxLength={20} showCount />
          </Form.Item>
          <Form.Item
            label="配置项说明"
            name="description"
            rules={[{ max: 200, message: "配置项说明不超过200个字符" }]}
          >
            <Input.TextArea placeholder="请输入配置项说明（可选）" maxLength={200} showCount rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ==================== Modal 2: Detail ==================== */}
      <Modal
        title={detailData ? `${detailData.name} - 配置项详情` : "配置项详情"}
        open={detailVisible}
        onCancel={() => {
          setDetailVisible(false);
          setDetailData(null);
        }}
        footer={null}
        width={720}
      >
        {detailData && (
          <>
            <Descriptions bordered column={2} size="small" loading={detailLoading}>
              <Descriptions.Item label="ID">{detailData.id}</Descriptions.Item>
              <Descriptions.Item label="配置项名称">{detailData.name}</Descriptions.Item>
              <Descriptions.Item label="配置项图标">
                <Image
                  src={getIconUrl(detailData.icon)}
                  alt="配置项图标"
                  width={64}
                  height={64}
                  style={{ objectFit: 'contain' }}
                  preview={{ mask: "查看原图" }}
                />
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                {detailData.status === 1 ? <Tag color="green">正常</Tag> : <Tag color="red">禁用</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="配置项说明" span={2}>
                {detailData.description || "-"}
              </Descriptions.Item>
              <Descriptions.Item label="创建人">{detailData.created_by_name || "-"}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{detailData.created_at}</Descriptions.Item>
              <Descriptions.Item label="修改人">{detailData.updated_by_name || "-"}</Descriptions.Item>
              <Descriptions.Item label="修改时间">{detailData.updated_at}</Descriptions.Item>
            </Descriptions>

            <div style={{ marginTop: 24 }}>
              <Title level={5} style={{ marginBottom: 12 }}>关联企业</Title>
              <Table
                columns={[{ title: "企业名称", dataIndex: "name", key: "name" }]}
                dataSource={detailData.enterprises || []}
                rowKey="id"
                size="small"
                pagination={false}
                locale={{ emptyText: "暂无关联企业" }}
              />
            </div>

            <div style={{ marginTop: 24 }}>
              <Title level={5} style={{ marginBottom: 12 }}>配置列表</Title>
              <Table
                columns={[
                  { title: "配置key", dataIndex: "config_key", key: "config_key" },
                  { title: "配置说明", dataIndex: "config_desc", key: "config_desc", render: (val: string | null) => val || "-" },
                ]}
                dataSource={detailData.entries || []}
                rowKey="id"
                size="small"
                pagination={false}
                locale={{ emptyText: "暂无配置项" }}
              />
            </div>
          </>
        )}
      </Modal>

      {/* ==================== Modal 3: Config Entries ==================== */}
      <Modal
        title={`${entriesItem?.name || ""} - 配置列表`}
        open={entriesModalVisible}
        onCancel={() => {
          setEntriesModalVisible(false);
          setEntriesItem(null);
          setEntriesData([]);
        }}
        onOk={handleSaveEntries}
        confirmLoading={entriesSaving}
        width={700}
      >
        <Table
          columns={entryColumns}
          dataSource={entriesData}
          rowKey="id"
          size="small"
          pagination={false}
          locale={{ emptyText: "暂无配置项，请点击下方按钮添加" }}
        />
        <Button
          type="dashed"
          block
          icon={<PlusOutlined />}
          onClick={handleAddEntry}
          style={{ marginTop: 16 }}
        >
          增加配置
        </Button>
      </Modal>

      {/* ==================== Modal 4: Enterprise Association ==================== */}
      <Modal
        title={`${enterpriseItem?.name || ""} - 关联企业`}
        open={enterpriseModalVisible}
        onCancel={() => {
          setEnterpriseModalVisible(false);
          setEnterpriseItem(null);
          setEnterpriseData([]);
        }}
        footer={null}
        width={800}
      >
        <Form form={enterpriseSearchForm} layout="inline" style={{ marginBottom: 16 }}>
          <Form.Item name="enterprise_name">
            <Input placeholder="企业名称" allowClear style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="enterprise_id">
            <Input placeholder="企业ID" allowClear style={{ width: 120 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button onClick={handleEnterpriseReset}>重置</Button>
              <Button type="primary" onClick={handleEnterpriseSearch}>查询</Button>
            </Space>
          </Form.Item>
        </Form>

        <Table
          columns={enterpriseColumns}
          dataSource={enterpriseData}
          rowKey="id"
          size="small"
          pagination={{
            current: enterprisePage,
            pageSize: 20,
            total: enterpriseTotal,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p) => setEnterprisePage(p),
          }}
          locale={{ emptyText: "未查询到企业" }}
        />
      </Modal>
    </div>
  );
};

export default ConfigItemList;
