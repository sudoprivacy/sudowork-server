import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Input,
  Button,
  Space,
  message,
  Tag,
  Typography,
  Empty,
  Select,
  Form,
  Table,
  Modal,
  Descriptions,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { SearchOutlined, LoadingOutlined, DownloadOutlined, LinkOutlined } from "@ant-design/icons";
import { adminApi } from "../api";

const { Title, Text } = Typography;
const { Search } = Input;
const { Option } = Select;

type AssetType = "skills" | "assistants";

interface SkillVersion {
  changelog: string | null;
  checksum: string;
  created_at: string;
  source_url: string;
  version: string;
}

interface Skill {
  id: string;
  name: string;
  display_name: string;
  description: string;
  category: string | null;
  categories: string[];
  core_features: string;
  applicable_scenarios: string;
  emoji: string | null;
  homepage: string | null;
  sort_order: number;
  icon: string | null;
  author_id: string;
  created_at: string;
  updated_at: string;
  status: number;
  tenant_id: string | null;
  latestVersion?: SkillVersion | null;
}

interface Assistant {
  id: string;
  name: string;
  profession: string;
  description: string;
  avatar: string | null;
  categories: string[];
  defaultInitPrompt: string | null;
  promptFile: string | null;
  sourceUrl: string;
  skills: string[];
  sortOrder: number;
  status: number;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Enterprise {
  id: number;
  name: string;
  code: string;
}

interface SkillsListProps {
  assetType: AssetType;
}

const SkillsList: React.FC<SkillsListProps> = ({ assetType }) => {
  const [loading, setLoading] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [approvingSkillId, setApprovingSkillId] = useState<string | null>(null);
  const [approvingAssistantId, setApprovingAssistantId] = useState<string | null>(null);
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null);
  const [deletingAssistantId, setDeletingAssistantId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEnterprise, setSelectedEnterprise] = useState<string | number | null>(null);
  const [detailRecord, setDetailRecord] = useState<Skill | Assistant | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [filterForm] = Form.useForm();

  const userStr = localStorage.getItem("admin_user");
  let currentUser: any = {};
  try {
    currentUser = userStr ? JSON.parse(userStr) : {};
  } catch {
    currentUser = {};
  }

  const isSuperAdmin = currentUser.role === "SUPER_ADMIN";
  const currentTenantId = currentUser.enterprise_code || currentUser.tenant_id;
  const isSkillsPage = assetType === "skills";
  const pageTitle = isSkillsPage ? "专属技能" : "专属助手";

  const isCursorResponseSuccess = (response: any) =>
    response?.success === true || response?.status === "success";

  useEffect(() => {
    if (isSuperAdmin) {
      void loadEnterprises();
    } else if (currentTenantId) {
      setSelectedEnterprise(currentTenantId as any);
    }
  }, []);

  useEffect(() => {
    if (selectedEnterprise || currentTenantId) {
      resetAndLoadData();
    }
  }, [selectedEnterprise, assetType, currentTenantId]);

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

  const getTenantId = () =>
    (isSuperAdmin ? selectedEnterprise : currentTenantId) as string | null;

  const resetAndLoadData = (query: string = searchQuery) => {
    if (isSkillsPage) {
      setSkills([]);
    } else {
      setAssistants([]);
    }
    setNextCursor(null);
    setHasMore(true);
    void loadData(null, query);
  };

  const loadSkills = useCallback(
    async (cursor: string | null = null, query: string = "") => {
      const tenantId = getTenantId();
      if (!tenantId) return;

      setLoading(true);
      try {
        const params: any = { limit: 20, tenant_id: tenantId };
        if (cursor) params.cursor = cursor;
        if (query) params.query = query;

        const response = await adminApi.getSkillsByCursor(params);
        if (isCursorResponseSuccess(response)) {
          const data = (response as any).data;
          const newSkills = (data.skills || []) as Skill[];
          setSkills((prev) => (cursor ? [...prev, ...newSkills] : newSkills));
          setNextCursor(data.next_cursor);
          setHasMore(data.has_more);
        } else {
          message.error((response as any).message || "加载技能列表失败");
        }
      } catch (error: any) {
        message.error(error?.response?.data?.message || error?.message || "加载技能列表失败，请刷新重试");
      } finally {
        setLoading(false);
      }
    },
    [selectedEnterprise, currentTenantId, isSuperAdmin]
  );

  const loadAssistants = useCallback(
    async (cursor: string | null = null, query: string = "") => {
      const tenantId = getTenantId();
      if (!tenantId) return;

      setLoading(true);
      try {
        const params: any = { limit: 20, tenant_id: tenantId };
        if (cursor) params.cursor = cursor;
        if (query) params.query = query;

        const response = await adminApi.getAssistantsByCursor(params);
        if (isCursorResponseSuccess(response)) {
          const data = (response as any).data;
          const newAssistants = (data.assistants || []) as Assistant[];
          setAssistants((prev) => (cursor ? [...prev, ...newAssistants] : newAssistants));
          setNextCursor(data.next_cursor);
          setHasMore(data.has_more);
        } else {
          message.error((response as any).message || "加载助手列表失败");
        }
      } catch (error: any) {
        message.error(error?.response?.data?.message || error?.message || "加载助手列表失败，请刷新重试");
      } finally {
        setLoading(false);
      }
    },
    [selectedEnterprise, currentTenantId, isSuperAdmin]
  );

  const loadData = useCallback(
    async (cursor: string | null = null, query: string = "") => {
      if (isSkillsPage) {
        await loadSkills(cursor, query);
      } else {
        await loadAssistants(cursor, query);
      }
    },
    [isSkillsPage, loadSkills, loadAssistants]
  );

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    resetAndLoadData(value);
  };

  const loadMore = () => {
    if (hasMore && !loading && nextCursor) {
      void loadData(nextCursor, searchQuery);
    }
  };

  const handleEnterpriseChange = (value: string) => {
    setSelectedEnterprise(value);
  };

  const openExternalUrl = (url?: string | null) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const isActionSuccess = (response: any) =>
    response?.success === true || response?.status === "success";

  const triggerDownload = (url?: string | null, filename?: string) => {
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    if (filename) link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const openDetail = (record: Skill | Assistant) => {
    setDetailRecord(record);
    setDetailOpen(true);
  };

  const handleApproveSkill = (record: Skill) => {
    Modal.confirm({
      title: "确认审批上线",
      content: `确定将技能“${record.display_name || record.name}”从审核中改为已上线吗？`,
      okText: "确认上线",
      cancelText: "取消",
      onOk: async () => {
        setApprovingSkillId(record.id);
        try {
          const response = await adminApi.approveSkill(record.id);
          if (isActionSuccess(response)) {
            message.success((response as any).msg || (response as any).message || "审批上线成功");
            if (detailRecord && "id" in detailRecord && detailRecord.id === record.id) {
              setDetailRecord({ ...record, status: 1 });
            }
            resetAndLoadData();
          } else {
            message.error((response as any).msg || (response as any).message || "审批上线失败");
          }
        } catch (error: any) {
          message.error(error?.response?.data?.msg || error?.response?.data?.message || error?.message || "审批上线失败");
        } finally {
          setApprovingSkillId(null);
        }
      },
    });
  };

  const handleDeleteSkill = (record: Skill) => {
    Modal.confirm({
      title: "确认删除技能",
      content: `确定删除技能“${record.display_name || record.name}”吗？删除后不可恢复。`,
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setDeletingSkillId(record.id);
        try {
          const response = await adminApi.deleteSkill(record.id);
          if (isActionSuccess(response)) {
            message.success((response as any).msg || (response as any).message || "删除成功");
            if (detailRecord && "id" in detailRecord && detailRecord.id === record.id) {
              closeDetail();
            }
            resetAndLoadData();
          } else {
            message.error((response as any).msg || (response as any).message || "删除失败");
          }
        } catch (error: any) {
          message.error(error?.response?.data?.msg || error?.response?.data?.message || error?.message || "删除失败");
        } finally {
          setDeletingSkillId(null);
        }
      },
    });
  };

  const handleApproveAssistant = (record: Assistant) => {
    Modal.confirm({
      title: "确认审批发布",
      content: `确定将助手“${record.name}”从审核中改为已发布吗？`,
      okText: "确认发布",
      cancelText: "取消",
      onOk: async () => {
        setApprovingAssistantId(record.id);
        try {
          const response = await adminApi.approveAssistant(record.id);
          if (isActionSuccess(response)) {
            message.success((response as any).msg || (response as any).message || "审批发布成功");
            if (detailRecord && "id" in detailRecord && detailRecord.id === record.id) {
              setDetailRecord({ ...record, status: 1 });
            }
            resetAndLoadData();
          } else {
            message.error((response as any).msg || (response as any).message || "审批发布失败");
          }
        } catch (error: any) {
          message.error(error?.response?.data?.msg || error?.response?.data?.message || error?.message || "审批发布失败");
        } finally {
          setApprovingAssistantId(null);
        }
      },
    });
  };

  const handleDeleteAssistant = (record: Assistant) => {
    Modal.confirm({
      title: "确认删除助手",
      content: `确定删除助手“${record.name}”吗？删除后不可恢复。`,
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setDeletingAssistantId(record.id);
        try {
          const response = await adminApi.deleteAssistant(record.id);
          if (isActionSuccess(response)) {
            message.success((response as any).msg || (response as any).message || "删除成功");
            if (detailRecord && "id" in detailRecord && detailRecord.id === record.id) {
              closeDetail();
            }
            resetAndLoadData();
          } else {
            message.error((response as any).msg || (response as any).message || "删除失败");
          }
        } catch (error: any) {
          message.error(error?.response?.data?.msg || error?.response?.data?.message || error?.message || "删除失败");
        } finally {
          setDeletingAssistantId(null);
        }
      },
    });
  };

  const closeDetail = () => {
    setDetailOpen(false);
    setDetailRecord(null);
  };

  const formatValue = (value?: string | number | boolean | null) => {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "boolean") return value ? "是" : "否";
    return String(value);
  };

  const getStatusLabel = (status: number) => {
    if (status === 1) {
      return isSkillsPage ? "已上线" : "已发布";
    }
    return "审核中";
  };

  const getStatusColor = (status: number) => (status === 1 ? "green" : "orange");

  const parseStructuredText = (value?: string | null) => {
    if (!value) return "-";
    try {
      const parsed = JSON.parse(value);
      return (
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    } catch {
      return <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{value}</div>;
    }
  };

  const skillColumns: ColumnsType<Skill> = [
    {
      title: "名称",
      dataIndex: "display_name",
      key: "display_name",
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.display_name || record.name}</Text>
          <Text type="secondary">{record.name}</Text>
        </Space>
      ),
    },
    {
      title: "版本",
      key: "version",
      width: 120,
      render: (_, record) => record.latestVersion?.version || "-",
    },
    {
      title: "分类",
      key: "category",
      render: (_, record) =>
        record.categories?.length ? (
          <Space wrap>
            {record.categories.map((item) => (
              <Tag key={item}>{item}</Tag>
            ))}
          </Space>
        ) : (
          record.category || "-"
        ),
    },
    {
      title: "状态",
      key: "status",
      width: 120,
      render: (_, record) => <Tag color={getStatusColor(record.status)}>{getStatusLabel(record.status)}</Tag>,
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      key: "updated_at",
      width: 200,
    },
    {
      title: "操作",
      key: "actions",
      width: 300,
      render: (_, record) => (
        <Space>
          <Button type="link" onClick={() => openDetail(record)}>
            查看详情
          </Button>
          {record.status !== 1 && (
            <Button
              type="link"
              onClick={() => handleApproveSkill(record)}
              loading={approvingSkillId === record.id}
            >
              审批上线
            </Button>
          )}
          {record.latestVersion?.source_url && (
            <Button
              type="link"
              icon={<DownloadOutlined />}
              onClick={() => triggerDownload(record.latestVersion?.source_url, `${record.name || "skill"}.zip`)}
            >
              下载
            </Button>
          )}
          {record.homepage && (
            <Button type="link" icon={<LinkOutlined />} onClick={() => openExternalUrl(record.homepage)}>
              链接
            </Button>
          )}
          <Button
            type="link"
            danger
            onClick={() => handleDeleteSkill(record)}
            loading={deletingSkillId === record.id}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const assistantColumns: ColumnsType<Assistant> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.name}</Text>
          <Text type="secondary">{record.profession || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "版本",
      key: "version",
      width: 120,
      render: () => "-",
    },
    {
      title: "分类",
      key: "categories",
      render: (_, record) =>
        record.categories?.length ? (
          <Space wrap>
            {record.categories.map((item) => (
              <Tag key={item}>{item}</Tag>
            ))}
          </Space>
        ) : (
          "-"
        ),
    },
    {
      title: "状态",
      key: "status",
      width: 120,
      render: (_, record) => <Tag color={getStatusColor(record.status)}>{getStatusLabel(record.status)}</Tag>,
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 200,
    },
    {
      title: "操作",
      key: "actions",
      width: 320,
      render: (_, record) => (
        <Space>
          <Button type="link" onClick={() => openDetail(record)}>
            查看详情
          </Button>
          {record.status !== 1 && (
            <Button
              type="link"
              onClick={() => handleApproveAssistant(record)}
              loading={approvingAssistantId === record.id}
            >
              审批发布
            </Button>
          )}
          {record.sourceUrl && (
            <Button
              type="link"
              icon={<DownloadOutlined />}
              onClick={() => triggerDownload(record.sourceUrl, `${record.name || "assistant"}.zip`)}
            >
              下载
            </Button>
          )}
          <Button
            type="link"
            danger
            onClick={() => handleDeleteAssistant(record)}
            loading={deletingAssistantId === record.id}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const renderDetailContent = () => {
    if (!detailRecord) return null;

    if (isSkillsPage) {
      const record = detailRecord as Skill;
      return (
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="名称">{record.display_name || record.name}</Descriptions.Item>
          <Descriptions.Item label="标识">{formatValue(record.name)}</Descriptions.Item>
          <Descriptions.Item label="版本">{formatValue(record.latestVersion?.version)}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={getStatusColor(record.status)}>{getStatusLabel(record.status)}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="分类">
            {record.categories?.length ? record.categories.join(", ") : formatValue(record.category)}
          </Descriptions.Item>
          <Descriptions.Item label="描述">{formatValue(record.description)}</Descriptions.Item>
          <Descriptions.Item label="核心功能">{parseStructuredText(record.core_features)}</Descriptions.Item>
          <Descriptions.Item label="适用场景">{parseStructuredText(record.applicable_scenarios)}</Descriptions.Item>
          <Descriptions.Item label="作者">{formatValue(record.author_id)}</Descriptions.Item>
          <Descriptions.Item label="租户">{formatValue(record.tenant_id)}</Descriptions.Item>
          <Descriptions.Item label="资源地址">{formatValue(record.latestVersion?.source_url)}</Descriptions.Item>
          <Descriptions.Item label="链接">{formatValue(record.homepage)}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{formatValue(record.created_at)}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{formatValue(record.updated_at)}</Descriptions.Item>
        </Descriptions>
      );
    }

    const record = detailRecord as Assistant;
    return (
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label="名称">{record.name}</Descriptions.Item>
        <Descriptions.Item label="职业">{formatValue(record.profession)}</Descriptions.Item>
        <Descriptions.Item label="版本">-</Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag color={getStatusColor(record.status)}>{getStatusLabel(record.status)}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="分类">
          {record.categories?.length ? record.categories.join(", ") : "-"}
        </Descriptions.Item>
        <Descriptions.Item label="描述">{formatValue(record.description)}</Descriptions.Item>
        <Descriptions.Item label="默认提示词">
          <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {formatValue(record.defaultInitPrompt)}
          </div>
        </Descriptions.Item>
        <Descriptions.Item label="提示词文件">{formatValue(record.promptFile)}</Descriptions.Item>
        <Descriptions.Item label="技能列表">
          {record.skills?.length ? record.skills.join(", ") : "-"}
        </Descriptions.Item>
        <Descriptions.Item label="租户">{formatValue(record.tenantId)}</Descriptions.Item>
        <Descriptions.Item label="资源地址">{formatValue(record.sourceUrl)}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{formatValue(record.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="更新时间">{formatValue(record.updatedAt)}</Descriptions.Item>
      </Descriptions>
    );
  };

  const dataSource = isSkillsPage ? skills : assistants;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <Title level={2} style={{ margin: 0 }}>
          {pageTitle}
        </Title>
      </div>

      <Card style={{ marginBottom: 12 }} styles={{ body: { padding: 12 } }}>
        <Form form={filterForm} layout="inline">
          {isSuperAdmin && (
            <Form.Item name="enterprise_id" label="所属企业">
              <Select
                placeholder="选择企业"
                style={{ width: 200 }}
                onChange={handleEnterpriseChange}
                value={selectedEnterprise}
              >
                {enterprises.map((e) => (
                  <Option key={e.id} value={e.code}>
                    {e.name}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          )}
          <Form.Item>
            <Search
              placeholder={`搜索${isSkillsPage ? "技能" : "助手"}名称或描述`}
              allowClear
              enterButton={<SearchOutlined />}
              style={{ width: 320 }}
              onSearch={handleSearch}
            />
          </Form.Item>
        </Form>
      </Card>

      <Card styles={{ body: { padding: 16 } }}>
        {!selectedEnterprise && isSuperAdmin ? (
          <Empty description={`请先选择企业查看其${pageTitle}`} />
        ) : dataSource.length === 0 && !loading ? (
          <Empty description={`暂无${pageTitle}`} />
        ) : (
          <>
            {isSkillsPage ? (
              <Table<Skill>
                rowKey="id"
                dataSource={skills}
                columns={skillColumns}
                loading={loading}
                pagination={false}
                scroll={{ x: 1100 }}
              />
            ) : (
              <Table<Assistant>
                rowKey="id"
                dataSource={assistants}
                columns={assistantColumns}
                loading={loading}
                pagination={false}
                scroll={{ x: 1100 }}
              />
            )}
            {dataSource.length > 0 && (
              <div style={{ textAlign: "center", marginTop: 20 }}>
                {hasMore ? (
                  <Button
                    type="primary"
                    onClick={loadMore}
                    loading={loading}
                    icon={loading ? <LoadingOutlined spin /> : null}
                  >
                    {loading ? "加载中..." : "加载更多"}
                  </Button>
                ) : (
                  <Text type="secondary">已加载全部{pageTitle}</Text>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      <Modal
        open={detailOpen}
        title={`${pageTitle}详情`}
        onCancel={closeDetail}
        width={820}
        footer={
          detailRecord ? [
            isSkillsPage && (detailRecord as Skill).status !== 1 ? (
              <Button
                key="approve"
                type="primary"
                loading={approvingSkillId === (detailRecord as Skill).id}
                onClick={() => handleApproveSkill(detailRecord as Skill)}
              >
                审批上线
              </Button>
            ) : null,
            isSkillsPage ? (
              <Button
                key="delete"
                danger
                loading={deletingSkillId === (detailRecord as Skill).id}
                onClick={() => handleDeleteSkill(detailRecord as Skill)}
              >
                删除技能
              </Button>
            ) : null,
            isSkillsPage && (detailRecord as Skill).latestVersion?.source_url ? (
              <Button
                key="download"
                icon={<DownloadOutlined />}
                onClick={() =>
                  triggerDownload((detailRecord as Skill).latestVersion?.source_url, `${(detailRecord as Skill).name}.zip`)
                }
              >
                下载资源
              </Button>
            ) : !isSkillsPage && (detailRecord as Assistant).sourceUrl ? (
              <Button
                key="download"
                icon={<DownloadOutlined />}
                onClick={() =>
                  triggerDownload((detailRecord as Assistant).sourceUrl, `${(detailRecord as Assistant).name}.zip`)
                }
              >
                下载资源
              </Button>
            ) : null,
            !isSkillsPage && (detailRecord as Assistant).promptFile ? (
              <Button
                key="prompt"
                icon={<DownloadOutlined />}
                onClick={() =>
                  triggerDownload((detailRecord as Assistant).promptFile, `${(detailRecord as Assistant).name}-prompt.txt`)
                }
              >
                下载提示词
              </Button>
            ) : null,
            !isSkillsPage && (detailRecord as Assistant).status !== 1 ? (
              <Button
                key="approve"
                type="primary"
                loading={approvingAssistantId === (detailRecord as Assistant).id}
                onClick={() => handleApproveAssistant(detailRecord as Assistant)}
              >
                审批发布
              </Button>
            ) : null,
            isSkillsPage && (detailRecord as Skill).homepage ? (
              <Button
                key="link"
                icon={<LinkOutlined />}
                onClick={() => openExternalUrl((detailRecord as Skill).homepage)}
              >
                访问链接
              </Button>
            ) : null,
            <Button key="close" type="primary" onClick={closeDetail}>
              关闭
            </Button>,
          ].filter(Boolean) as React.ReactNode[]
          : undefined
        }
      >
        {renderDetailContent()}
      </Modal>
    </div>
  );
};

export default SkillsList;
