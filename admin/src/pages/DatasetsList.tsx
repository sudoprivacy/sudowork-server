/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 知识库管理页 — P3 RAG 挂载实现 (2026-06-23)。
 *
 * 列表 + 创建 + 编辑 + 删除 + 文档管理 Drawer + 测试查询 Drawer。
 *
 * 所有调用走 `/api/v1/admin/datasets/*`，后端用 Dify Service API
 * (tenant-scoped key) 代理。详见 `2026-06-17-dify-integration-design.md`
 * §"P3 RAG 挂载"。
 *
 * 企业切换语义复用 SkillsList 的约定：
 *   - 超级管理员：从下拉选企业 → enterprise_id 来自 enterprises 列表
 *   - 企业管理员：自动从 JWT 拿 enterprise_id（页面不显示选择器）
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import {
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { adminApi } from "../api";
import { useDifyFeatureFlag } from "../hooks/useDifyFeatureFlag";

const { Text, Title } = Typography;

interface DatasetRow {
  id: string;
  name: string;
  description?: string | null;
  permission?: string;
  document_count?: number;
  word_count?: number;
  app_count?: number;
  indexing_technique?: string | null;
  created_at?: number;
  updated_at?: number;
}

interface DocumentRow {
  id: string;
  name: string;
  data_source_type?: string;
  indexing_status?: string;
  enabled?: boolean;
  word_count?: number;
  hit_count?: number;
  created_at?: number;
  display_status?: string;
}

interface EnterpriseSummary {
  id: number;
  code: string;
  name: string;
}

interface RetrievedSegment {
  segment?: { content?: string; document?: { name?: string } };
  score?: number;
}

const INDEXING_OPTIONS = [
  { label: "经济模式 (Economy, 仅关键词索引)", value: "economy" as const },
  { label: "高质量 (High Quality, 向量索引)", value: "high_quality" as const },
];

function formatUnixSeconds(ts?: number): string {
  if (!ts) return "-";
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return "-";
  }
}

const DatasetsList: React.FC = () => {
  // ----- Auth / enterprise scoping -----
  const userStr = localStorage.getItem("admin_user");
  let currentUser: any = {};
  try {
    currentUser = userStr ? JSON.parse(userStr) : {};
  } catch {
    /* noop */
  }
  const isSuperAdmin = currentUser.role === "SUPER_ADMIN";

  // Dataset endpoints all proxy to Dify Service API. When sudowork-server
  // isn't configured with DIFY_* env vars we short-circuit the whole page
  // to a "未开启" notice instead of letting every action burst into 503s.
  const difyFlag = useDifyFeatureFlag();
  const difyDisabled = !difyFlag.loading && !difyFlag.enabled;

  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [selectedEnterpriseCode, setSelectedEnterpriseCode] = useState<string | null>(null);

  const selectedEnterpriseId = useMemo<number | undefined>(() => {
    if (!isSuperAdmin) {
      return (currentUser.enterprise_id as number | undefined) ?? undefined;
    }
    if (!selectedEnterpriseCode) return undefined;
    return enterprises.find((e) => e.code === selectedEnterpriseCode)?.id;
  }, [isSuperAdmin, selectedEnterpriseCode, enterprises, currentUser.enterprise_id]);

  // ----- Listing -----
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(30);
  const [total, setTotal] = useState(0);

  const reload = useCallback(async () => {
    if (difyDisabled) {
      setDatasets([]);
      setTotal(0);
      return;
    }
    if (!selectedEnterpriseId) {
      setDatasets([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    try {
      const resp: any = await adminApi.listDatasetsAdmin({
        enterprise_id: selectedEnterpriseId,
        page,
        limit: pageSize,
        keyword: keyword || undefined,
      });
      if (resp?.success) {
        const inner = resp.data?.data ?? [];
        setDatasets(inner);
        setTotal(resp.data?.total ?? inner.length);
      } else {
        message.error(resp?.msg || "加载知识库失败");
      }
    } catch (err: any) {
      message.error(err?.response?.data?.msg || err?.message || "加载知识库失败");
    } finally {
      setLoading(false);
    }
  }, [difyDisabled, selectedEnterpriseId, page, pageSize, keyword]);

  useEffect(() => {
    if (difyDisabled) return;
    if (isSuperAdmin) {
      adminApi
        .getEnterprises()
        .then((r: any) => {
          if (r?.success) setEnterprises(r.data || []);
        })
        .catch(() => undefined);
    }
  }, [difyDisabled, isSuperAdmin]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ----- Create / Edit modal -----
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const [editingRow, setEditingRow] = useState<DatasetRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();

  const handleCreate = async () => {
    if (!selectedEnterpriseId) {
      message.error("请先选择企业");
      return;
    }
    const values = await createForm.validateFields();
    setSubmitting(true);
    try {
      const resp: any = await adminApi.createDataset({
        enterprise_id: selectedEnterpriseId,
        name: values.name,
        description: values.description,
        indexing_technique: values.indexing_technique,
      });
      if (resp?.success) {
        message.success("创建成功");
        setCreateOpen(false);
        createForm.resetFields();
        void reload();
      } else {
        message.error(resp?.msg || "创建失败");
      }
    } catch (err: any) {
      message.error(err?.response?.data?.msg || err?.message || "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (row: DatasetRow) => {
    setEditingRow(row);
    editForm.setFieldsValue({
      name: row.name,
      description: row.description ?? "",
    });
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editingRow || !selectedEnterpriseId) return;
    const values = await editForm.validateFields();
    setSubmitting(true);
    try {
      // We intentionally don't expose dataset.permission in the UI: it only
      // controls "which Dify Account sees this dataset inside Dify Studio",
      // which is an admin-convenience concern. End-user access to knowledge
      // is derived from the assistant's ACL (assistant_acl table) at
      // runtime — see design doc §"权限模型 / 派生规则".
      const resp: any = await adminApi.updateDataset(editingRow.id, {
        enterprise_id: selectedEnterpriseId,
        name: values.name,
        description: values.description,
      });
      if (resp?.success) {
        message.success("已保存");
        setEditOpen(false);
        void reload();
      } else {
        message.error(resp?.msg || "保存失败");
      }
    } catch (err: any) {
      message.error(err?.response?.data?.msg || err?.message || "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (row: DatasetRow) => {
    if (!selectedEnterpriseId) return;
    try {
      const resp: any = await adminApi.deleteDataset(row.id, {
        enterprise_id: selectedEnterpriseId,
      });
      if (resp?.success) {
        message.success("已删除");
        void reload();
      } else {
        message.error(resp?.msg || "删除失败");
      }
    } catch (err: any) {
      message.error(err?.response?.data?.msg || err?.message || "删除失败");
    }
  };

  // ----- Documents drawer -----
  const [docsDrawer, setDocsDrawer] = useState<DatasetRow | null>(null);

  // ----- Retrieve (test query) drawer -----
  const [retrieveDrawer, setRetrieveDrawer] = useState<DatasetRow | null>(null);

  // ----- Columns -----
  const columns: ColumnsType<DatasetRow> = [
    {
      title: "名称",
      key: "name",
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{row.name}</Text>
          {row.description ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {row.description}
            </Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "文档数",
      dataIndex: "document_count",
      width: 80,
      align: "right",
      render: (v) => v ?? 0,
    },
    {
      title: "字符数",
      dataIndex: "word_count",
      width: 100,
      align: "right",
      render: (v) => (typeof v === "number" ? v.toLocaleString() : "0"),
    },
    {
      title: "关联 App",
      dataIndex: "app_count",
      width: 100,
      align: "right",
      render: (v) => v ?? 0,
    },
    {
      title: "索引方式",
      dataIndex: "indexing_technique",
      width: 110,
      render: (v) =>
        v === "high_quality" ? (
          <Tag color="blue">高质量</Tag>
        ) : v === "economy" ? (
          <Tag>经济</Tag>
        ) : (
          <Tag>未配置</Tag>
        ),
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      width: 170,
      render: formatUnixSeconds,
    },
    {
      title: "操作",
      key: "actions",
      width: 280,
      render: (_, row) => (
        <Space size="small">
          <Tooltip title="编辑名称 / 描述">
            <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(row)}>
              编辑
            </Button>
          </Tooltip>
          <Tooltip title="文档管理">
            <Button type="link" icon={<FileTextOutlined />} onClick={() => setDocsDrawer(row)}>
              文档
            </Button>
          </Tooltip>
          <Tooltip title="测试查询">
            <Button
              type="link"
              icon={<ExperimentOutlined />}
              onClick={() => setRetrieveDrawer(row)}
            >
              测试
            </Button>
          </Tooltip>
          <Popconfirm
            title={`确定删除知识库「${row.name}」吗？`}
            description="此操作不可撤销，包含的所有文档和向量都会被清除。"
            onConfirm={() => handleDelete(row)}
            okText="确定删除"
            cancelText="取消"
            okType="danger"
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (difyDisabled) {
    return (
      <div>
        <Title level={3} style={{ marginTop: 0 }}>
          <DatabaseOutlined /> 知识库管理
        </Title>
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
          message="知识库功能未开启"
          description={
            <>
              知识库 CRUD 全部走 Dify Service API，需要先在 sudowork-server 配置
              {" "}
              <Text code>{difyFlag.missingEnv.join(", ") || "DIFY_*"}</Text>
              {" "}并重启服务。补齐后该页面会自动恢复全部功能（列表 / 创建 / 编辑 /
              删除 / 文档管理 / 测试查询）。
            </>
          }
        />
        <Empty
          description="Dify 集成未配置 - 知识库管理暂不可用"
          style={{ marginTop: 32 }}
        />
      </div>
    );
  }

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>
        <DatabaseOutlined /> 知识库管理
      </Title>
      <Text type="secondary">
        管理企业 Dify 租户内的知识库（dataset）。这些知识库可在「专属助手 → 新建/编辑 →
        启用知识库」分支里被关联使用。
      </Text>

      <Card style={{ marginTop: 16 }}>
        <Space style={{ marginBottom: 16 }} wrap>
          {isSuperAdmin && (
            <Select
              placeholder="选择企业"
              style={{ width: 220 }}
              value={selectedEnterpriseCode}
              onChange={(v) => {
                setSelectedEnterpriseCode(v);
                setPage(1);
              }}
              options={enterprises.map((e) => ({ label: `${e.name} (${e.code})`, value: e.code }))}
              showSearch
              optionFilterProp="label"
              allowClear
            />
          )}
          <Input
            placeholder="搜索知识库名称"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => {
              setPage(1);
              void reload();
            }}
            prefix={<SearchOutlined />}
            style={{ width: 220 }}
            allowClear
          />
          <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              if (!selectedEnterpriseId) {
                message.error("请先选择企业");
                return;
              }
              createForm.resetFields();
              createForm.setFieldsValue({ indexing_technique: "economy" });
              setCreateOpen(true);
            }}
          >
            新建知识库
          </Button>
        </Space>

        {!selectedEnterpriseId ? (
          <Empty description={isSuperAdmin ? "请先选择企业" : "无法解析企业身份"} />
        ) : (
          <Table
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={datasets}
            pagination={{
              current: page,
              pageSize,
              total,
              onChange: (p) => setPage(p),
              showSizeChanger: false,
              showTotal: (n) => `共 ${n} 个`,
            }}
            size="middle"
            locale={{
              emptyText: <Empty description="该企业暂无知识库，点击「新建知识库」开始" />,
            }}
          />
        )}
      </Card>

      {/* ===== Create modal ===== */}
      <Modal
        title="新建知识库"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        okText="创建"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: "请输入知识库名称" }]}
          >
            <Input placeholder="例如：法律法规库 / 公司规章" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="可选" />
          </Form.Item>
          <Form.Item
            name="indexing_technique"
            label="索引方式"
            rules={[{ required: true }]}
            tooltip="经济模式仅做关键词索引，免费；高质量模式做向量索引，需要 embedding 模型，更准确但消耗 token"
          >
            <Select options={INDEXING_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ===== Edit modal ===== */}
      <Modal
        title={`编辑：${editingRow?.name ?? ""}`}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleEdit}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ===== Documents drawer ===== */}
      <DocumentsDrawer
        dataset={docsDrawer}
        enterpriseId={selectedEnterpriseId}
        onClose={() => setDocsDrawer(null)}
        onMutated={() => void reload()}
      />

      {/* ===== Retrieve (test query) drawer ===== */}
      <RetrieveDrawer
        dataset={retrieveDrawer}
        enterpriseId={selectedEnterpriseId}
        onClose={() => setRetrieveDrawer(null)}
      />
    </div>
  );
};

// ============================================================================
// Documents Drawer — list / upload / delete
// ============================================================================

const DocumentsDrawer: React.FC<{
  dataset: DatasetRow | null;
  enterpriseId: number | undefined;
  onClose: () => void;
  onMutated: () => void;
}> = ({ dataset, enterpriseId, onClose, onMutated }) => {
  const open = !!dataset;
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadMode, setUploadMode] = useState<"text" | "file">("text");
  const [textForm] = Form.useForm();
  const [fileForm] = Form.useForm();
  const [pendingFile, setPendingFile] = useState<UploadFile | null>(null);
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(async () => {
    if (!dataset || !enterpriseId) return;
    setLoading(true);
    try {
      const resp: any = await adminApi.listDatasetDocuments(dataset.id, {
        enterprise_id: enterpriseId,
        page: 1,
        limit: 100,
      });
      if (resp?.success) {
        setDocs(resp.data?.data ?? []);
      } else {
        message.error(resp?.msg || "加载文档失败");
      }
    } catch (err: any) {
      message.error(err?.response?.data?.msg || err?.message || "加载文档失败");
    } finally {
      setLoading(false);
    }
  }, [dataset, enterpriseId]);

  useEffect(() => {
    if (open) {
      void refresh();
      textForm.resetFields();
      fileForm.resetFields();
      setPendingFile(null);
    }
  }, [open, refresh, textForm, fileForm]);

  const handleTextUpload = async () => {
    if (!dataset || !enterpriseId) return;
    const values = await textForm.validateFields();
    setUploading(true);
    try {
      const resp: any = await adminApi.createDatasetDocumentByText(dataset.id, {
        enterprise_id: enterpriseId,
        name: values.name,
        text: values.text,
        indexing_technique: values.indexing_technique,
      });
      if (resp?.success) {
        message.success("已添加文本文档，索引中…");
        textForm.resetFields();
        await refresh();
        onMutated();
      } else {
        message.error(resp?.msg || "上传失败");
      }
    } catch (err: any) {
      message.error(err?.response?.data?.msg || err?.message || "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = async () => {
    if (!dataset || !enterpriseId) return;
    if (!pendingFile?.originFileObj) {
      message.error("请选择文件");
      return;
    }
    const values = fileForm.getFieldsValue();
    setUploading(true);
    try {
      const form = new FormData();
      form.append("enterprise_id", String(enterpriseId));
      form.append("file", pendingFile.originFileObj as File, pendingFile.name);
      if (values.indexing_technique) {
        form.append("indexing_technique", values.indexing_technique);
      }
      const resp: any = await adminApi.createDatasetDocumentByFile(dataset.id, form);
      if (resp?.success) {
        message.success("文件上传成功，索引中…");
        setPendingFile(null);
        await refresh();
        onMutated();
      } else {
        message.error(resp?.msg || "上传失败");
      }
    } catch (err: any) {
      message.error(err?.response?.data?.msg || err?.message || "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (doc: DocumentRow) => {
    if (!dataset || !enterpriseId) return;
    try {
      const resp: any = await adminApi.deleteDatasetDocument(dataset.id, doc.id, {
        enterprise_id: enterpriseId,
      });
      if (resp?.success) {
        message.success("已删除");
        await refresh();
        onMutated();
      } else {
        message.error(resp?.msg || "删除失败");
      }
    } catch (err: any) {
      message.error(err?.response?.data?.msg || err?.message || "删除失败");
    }
  };

  const docColumns: ColumnsType<DocumentRow> = [
    {
      title: "名称",
      dataIndex: "name",
      render: (v: string) => <Text>{v}</Text>,
    },
    {
      title: "字符数",
      dataIndex: "word_count",
      width: 90,
      align: "right",
      render: (v) => (typeof v === "number" ? v.toLocaleString() : "-"),
    },
    {
      title: "状态",
      dataIndex: "indexing_status",
      width: 110,
      render: (v: string) => {
        const color =
          v === "completed"
            ? "green"
            : v === "indexing" || v === "parsing" || v === "splitting"
              ? "blue"
              : v === "error"
                ? "red"
                : "default";
        return <Tag color={color}>{v ?? "-"}</Tag>;
      },
    },
    {
      title: "命中次数",
      dataIndex: "hit_count",
      width: 90,
      align: "right",
      render: (v) => v ?? 0,
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      width: 170,
      render: formatUnixSeconds,
    },
    {
      title: "操作",
      key: "actions",
      width: 90,
      render: (_, row) => (
        <Popconfirm
          title={`删除文档「${row.name}」？`}
          onConfirm={() => handleDeleteDoc(row)}
          okText="删除"
          okType="danger"
          cancelText="取消"
        >
          <Button type="link" danger icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Drawer
      title={dataset ? `文档管理 - ${dataset.name}` : ""}
      open={open}
      onClose={onClose}
      width={780}
      destroyOnClose
    >
      <Card title="新增文档" size="small" style={{ marginBottom: 16 }}>
        <Space style={{ marginBottom: 12 }}>
          <Button
            size="small"
            type={uploadMode === "text" ? "primary" : "default"}
            onClick={() => setUploadMode("text")}
          >
            粘贴文本
          </Button>
          <Button
            size="small"
            type={uploadMode === "file" ? "primary" : "default"}
            onClick={() => setUploadMode("file")}
          >
            上传文件
          </Button>
        </Space>

        {uploadMode === "text" ? (
          <Form form={textForm} layout="vertical">
            <Form.Item name="name" label="文档名" rules={[{ required: true }]}>
              <Input placeholder="例如：劳动合同范本" />
            </Form.Item>
            <Form.Item name="text" label="文本内容" rules={[{ required: true }]}>
              <Input.TextArea rows={6} placeholder="粘贴 Markdown / 纯文本" />
            </Form.Item>
            <Form.Item
              name="indexing_technique"
              label="索引方式"
              initialValue="economy"
            >
              <Select options={INDEXING_OPTIONS} />
            </Form.Item>
            <Button type="primary" loading={uploading} onClick={handleTextUpload}>
              添加
            </Button>
          </Form>
        ) : (
          <Form form={fileForm} layout="vertical">
            <Form.Item label="文件">
              <Upload
                accept=".txt,.md,.markdown,.pdf,.docx,.csv,.json,.html,.htm"
                maxCount={1}
                beforeUpload={() => false}
                fileList={pendingFile ? [pendingFile] : []}
                onChange={({ fileList }) => setPendingFile(fileList[0] || null)}
              >
                <Button icon={<UploadOutlined />}>选择文件</Button>
              </Upload>
            </Form.Item>
            <Form.Item
              name="indexing_technique"
              label="索引方式"
              initialValue="economy"
            >
              <Select options={INDEXING_OPTIONS} />
            </Form.Item>
            <Button type="primary" loading={uploading} onClick={handleFileUpload}>
              上传
            </Button>
          </Form>
        )}
      </Card>

      <Card
        title="已有文档"
        size="small"
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void refresh()}>
            刷新
          </Button>
        }
      >
        <Table
          rowKey="id"
          loading={loading}
          columns={docColumns}
          dataSource={docs}
          pagination={false}
          size="small"
          locale={{ emptyText: "暂无文档" }}
        />
      </Card>
    </Drawer>
  );
};

// ============================================================================
// Retrieve Drawer — hit-testing
// ============================================================================

const RetrieveDrawer: React.FC<{
  dataset: DatasetRow | null;
  enterpriseId: number | undefined;
  onClose: () => void;
}> = ({ dataset, enterpriseId, onClose }) => {
  const open = !!dataset;
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [searchMethod, setSearchMethod] = useState<
    "semantic_search" | "full_text_search" | "hybrid_search" | "keyword_search"
  >("semantic_search");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RetrievedSegment[]>([]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  const handleSearch = async () => {
    if (!dataset || !enterpriseId) return;
    if (!query.trim()) {
      message.error("请输入查询语句");
      return;
    }
    setLoading(true);
    try {
      const resp: any = await adminApi.retrieveDataset(dataset.id, {
        enterprise_id: enterpriseId,
        query: query.trim(),
        retrieval_model: {
          search_method: searchMethod,
          top_k: topK,
          reranking_enable: false,
          score_threshold_enabled: false,
        },
      });
      if (resp?.success) {
        const records = (resp.data as { records?: RetrievedSegment[] })?.records ?? [];
        setResults(records);
        if (records.length === 0) {
          message.info("没有匹配的片段");
        }
      } else {
        message.error(resp?.msg || "查询失败");
      }
    } catch (err: any) {
      message.error(err?.response?.data?.msg || err?.message || "查询失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      title={dataset ? `测试查询 - ${dataset.name}` : ""}
      open={open}
      onClose={onClose}
      width={720}
      destroyOnClose
    >
      <Card size="small" style={{ marginBottom: 16 }}>
        <Form layout="vertical">
          <Form.Item label="查询内容">
            <Input.TextArea
              rows={3}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入用户可能会问的问题"
            />
          </Form.Item>
          <Space>
            <Form.Item
              label="检索方式"
              style={{ marginBottom: 0 }}
              tooltip={
                <div style={{ maxWidth: 320 }}>
                  <div>
                    <b>语义检索 (semantic)</b>：用向量相似度查找意思相近的内容。最准，对同义改写友好；需要知识库已用 embedding 模型完成索引（高质量模式）。
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <b>全文检索 (full text)</b>：基于倒排索引的全词匹配，速度快，能命中精确词组。适合术语、代码、名称类查询。
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <b>混合 (hybrid)</b>：同时跑语义 + 全文，再合并打分。综合最稳，但成本和延迟稍高。
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <b>关键词 (keyword)</b>：仅做关键词匹配，零模型成本。经济索引模式下唯一可用的选项。
                  </div>
                </div>
              }
            >
              <Select
                value={searchMethod}
                style={{ width: 180 }}
                onChange={(v) => setSearchMethod(v as typeof searchMethod)}
                options={[
                  { label: "语义检索 (semantic)", value: "semantic_search" },
                  { label: "全文检索 (full text)", value: "full_text_search" },
                  { label: "混合 (hybrid)", value: "hybrid_search" },
                  { label: "关键词 (keyword)", value: "keyword_search" },
                ]}
              />
            </Form.Item>
            <Form.Item
              label="Top K"
              style={{ marginBottom: 0 }}
              tooltip="返回相关度最高的前 K 个文档片段。K 越大召回越全但噪声越多；线上对话场景常用 3~5，希望覆盖更广可调到 8~10。"
            >
              <Select
                value={topK}
                style={{ width: 90 }}
                onChange={(v) => setTopK(v as number)}
                options={[1, 2, 3, 5, 8, 10].map((n) => ({ label: String(n), value: n }))}
              />
            </Form.Item>
            <Form.Item label=" " style={{ marginBottom: 0 }}>
              <Button type="primary" loading={loading} onClick={handleSearch}>
                查询
              </Button>
            </Form.Item>
          </Space>
        </Form>
      </Card>

      {loading ? (
        <div style={{ textAlign: "center", padding: 48 }}>
          <Spin />
        </div>
      ) : results.length === 0 ? (
        <Empty description="尚未查询，或暂无匹配结果" />
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          {results.map((r, idx) => (
            <Card
              key={idx}
              size="small"
              title={
                <Space>
                  <Tag color="blue">#{idx + 1}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {r.segment?.document?.name ?? "未命名文档"}
                  </Text>
                  {typeof r.score === "number" && (
                    <Tag color="green">score: {r.score.toFixed(3)}</Tag>
                  )}
                </Space>
              }
            >
              <Text style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
                {r.segment?.content ?? "(空)"}
              </Text>
            </Card>
          ))}
        </Space>
      )}
    </Drawer>
  );
};

export default DatasetsList;
