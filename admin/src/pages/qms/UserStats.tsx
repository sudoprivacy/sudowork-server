/**
 * User Statistics page
 * Shows user-level conversation, turn, and step statistics with leaderboards
 */

import React, { useState, useEffect } from "react";
import { Card, Table, Tag, Spin, Row, Col, Select, Segmented, Modal, Statistic, Tooltip, Space } from "antd";
import { TrophyOutlined, UserOutlined, InfoCircleOutlined, TeamOutlined, UserOutlined as PersonalOutlined, DatabaseOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { api } from "../../api/qms/client";
import { TimeRangeFilter } from "../../components/qms";
import { useCachedTimeRange, useQmsTenantFilter } from "../../hooks/qms";
import type {
  UserConversationStats,
  UserTurnStats,
  UserStepStats,
  UserLeaderboardEntry,
  UserDetailStats,
  UserRealtimeStats,
} from "../../api/qms/types";

type StatsTab = "conversations" | "turns" | "steps";
type LoginModeFilter = "all" | "enterprise" | "personal";

// Step type Chinese labels
const stepTypeLabels: Record<string, string> = {
  tool_call: "工具调用",
  permission_request: "权限请求",
  file_operation: "文件操作",
  thinking: "思考",
};

// Login mode Chinese labels
const loginModeLabels: Record<string, string> = {
  enterprise: "企业",
  personal: "个人",
};

export default function UserStats() {
  const [loading, setLoading] = useState(true);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [realtimeLoading, setRealtimeLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<StatsTab>("conversations");
  const { timeRange, activePreset, setTimeRange, applyPreset } = useCachedTimeRange("user-stats");
  const tenantFilter = useQmsTenantFilter();

  // Data states
  const [conversationData, setConversationData] = useState<UserConversationStats[]>([]);
  const [turnData, setTurnData] = useState<UserTurnStats[]>([]);
  const [stepData, setStepData] = useState<UserStepStats[]>([]);
  const [leaderboardOrder, setLeaderboardOrder] = useState<"asc" | "desc">("desc");
  const [leaderboardData, setLeaderboardData] = useState<{
    conversations: UserLeaderboardEntry[];
    turns: UserLeaderboardEntry[];
    steps: UserLeaderboardEntry[];
    tokens: UserLeaderboardEntry[];
  }>({
    conversations: [],
    turns: [],
    steps: [],
    tokens: [],
  });
  const [realtimeStats, setRealtimeStats] = useState<UserRealtimeStats | null>(null);

  // Filter states
  const [stepTypeFilter, setStepTypeFilter] = useState<string | undefined>(undefined);
  const [loginModeFilter, setLoginModeFilter] = useState<LoginModeFilter>("all");

  // Modal state
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<UserDetailStats | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetchRealtimeStats();
  }, [timeRange, tenantFilter]);

  useEffect(() => {
    fetchData();
  }, [activeTab, timeRange, stepTypeFilter, loginModeFilter, tenantFilter]);

  useEffect(() => {
    fetchLeaderboard();
  }, [timeRange, leaderboardOrder, loginModeFilter, tenantFilter]);

  const fetchRealtimeStats = async () => {
    setRealtimeLoading(true);
    try {
      const data = await api.getUserRealtimeStats(timeRange[0], timeRange[1]);
      setRealtimeStats(data);
    } catch (err) {
      console.error("Failed to fetch realtime stats:", err);
    } finally {
      setRealtimeLoading(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = {
        start_time: timeRange[0],
        end_time: timeRange[1],
        limit: 50,
        ...(loginModeFilter !== "all" && { login_mode: loginModeFilter }),
      };

      if (activeTab === "conversations") {
        const data = await api.getUserConversationStats(params);
        setConversationData(data);
      } else if (activeTab === "turns") {
        const data = await api.getUserTurnStats(params);
        setTurnData(data);
      } else {
        const data = await api.getUserStepStats({
          ...params,
          step_type: stepTypeFilter,
        });
        setStepData(data);
      }
    } catch (err) {
      console.error("Failed to fetch user stats:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLeaderboard = async () => {
    setLeaderboardLoading(true);
    try {
      const params = {
        start_time: timeRange[0],
        end_time: timeRange[1],
        order: leaderboardOrder,
        limit: 10,
        ...(loginModeFilter !== "all" && { login_mode: loginModeFilter }),
      };
      const [conversations, turns, steps, tokens] = await Promise.all([
        api.getUserLeaderboard("conversations", params),
        api.getUserLeaderboard("turns", params),
        api.getUserLeaderboard("steps", params),
        api.getUserLeaderboard("tokens", params),
      ]);
      setLeaderboardData({ conversations, turns, steps, tokens });
    } catch (err) {
      console.error("Failed to fetch leaderboard:", err);
    } finally {
      setLeaderboardLoading(false);
    }
  };

  const showUserDetail = async (userId: string) => {
    setSelectedUserId(userId);
    setDetailModalVisible(true);
    setDetailLoading(true);
    try {
      const detail = await api.getUserDetail(userId, {
        start_time: timeRange[0],
        end_time: timeRange[1],
      });
      setUserDetail(detail);
    } catch (err) {
      console.error("Failed to fetch user detail:", err);
    } finally {
      setDetailLoading(false);
    }
  };

  // Helper function to display user name (nickname or user_id)
  const renderUserName = (user_id: string, user_nickname?: string, onClick?: () => void) => {
    const displayName = user_nickname || user_id.slice(0, 8);
    if (onClick) {
      return (
        <a onClick={onClick}>
          <UserOutlined /> {displayName}
        </a>
      );
    }
    return (
      <span>
        <UserOutlined /> {displayName}
      </span>
    );
  };

  const conversationColumns = [
    {
      title: "用户",
      dataIndex: "user_id",
      key: "user_id",
      render: (_: string, record: UserConversationStats) => (
        renderUserName(record.user_id, record.user_nickname, () => showUserDetail(record.user_id))
      ),
    },
    // 组织 ID 列暂时隐藏（目前只有个人模式数据）
    // {
    //   title: "组织 ID",
    //   dataIndex: "org_id",
    //   key: "org_id",
    //   render: (text?: string) => text ? <Tag color="blue">{text.slice(0, 8)}...</Tag> : "-",
    // },
    // 模式列暂时隐藏（目前只有个人模式数据）
    // {
    //   title: "模式",
    //   dataIndex: "login_mode",
    //   key: "login_mode",
    //   render: (text?: string) => (
    //     <Tag color={text === "enterprise" ? "purple" : text === "personal" ? "cyan" : "default"}>
    //       {text === "enterprise" ? <TeamOutlined /> : <PersonalOutlined />} {text ? loginModeLabels[text] : "-"}
    //     </Tag>
    //   ),
    // },
    {
      title: "会话数",
      dataIndex: "conversation_count",
      key: "conversation_count",
      sorter: (a: UserConversationStats, b: UserConversationStats) => a.conversation_count - b.conversation_count,
    },
    {
      title: "总 Tokens",
      dataIndex: "total_tokens",
      key: "total_tokens",
      render: (val: number) => val.toLocaleString(),
    },
    {
      title: "平均时长",
      dataIndex: "avg_duration_ms",
      key: "avg_duration_ms",
      render: (val: number) => `${(Number(val) / 1000).toFixed(1)}s`,
    },
    {
      title: "成功率",
      dataIndex: "success_rate",
      key: "success_rate",
      render: (val: number) => {
        const numVal = Number(val);
        return (
          <Tag color={numVal >= 90 ? "green" : numVal >= 70 ? "orange" : "red"}>
            {numVal.toFixed(1)}%
          </Tag>
        );
      },
    },
    {
      title: "错误数",
      dataIndex: "error_count",
      key: "error_count",
      render: (val: number) => val > 0 ? <Tag color="red">{val}</Tag> : <Tag color="green">0</Tag>,
    },
  ];

  const turnColumns = [
    {
      title: "用户",
      dataIndex: "user_id",
      key: "user_id",
      render: (_: string, record: UserTurnStats) => (
        renderUserName(record.user_id, record.user_nickname, () => showUserDetail(record.user_id))
      ),
    },
    // 组织 ID 列暂时隐藏（目前只有个人模式数据）
    // {
    //   title: "组织 ID",
    //   dataIndex: "org_id",
    //   key: "org_id",
    //   render: (text?: string) => text ? <Tag color="blue">{text.slice(0, 8)}...</Tag> : "-",
    // },
    // 模式列暂时隐藏（目前只有个人模式数据）
    // {
    //   title: "模式",
    //   dataIndex: "login_mode",
    //   key: "login_mode",
    //   render: (text?: string) => (
    //     <Tag color={text === "enterprise" ? "purple" : text === "personal" ? "cyan" : "default"}>
    //       {text === "enterprise" ? <TeamOutlined /> : <PersonalOutlined />} {text ? loginModeLabels[text] : "-"}
    //     </Tag>
    //   ),
    // },
    {
      title: "Turn 数",
      dataIndex: "turn_count",
      key: "turn_count",
      sorter: (a: UserTurnStats, b: UserTurnStats) => a.turn_count - b.turn_count,
    },
    {
      title: "总 Tokens",
      dataIndex: "total_tokens",
      key: "total_tokens",
      render: (val: number) => val.toLocaleString(),
    },
    {
      title: "平均 Tokens/Turn",
      dataIndex: "avg_tokens_per_turn",
      key: "avg_tokens_per_turn",
      render: (val: number) => val.toLocaleString(),
    },
    {
      title: "成功率",
      dataIndex: "success_rate",
      key: "success_rate",
      render: (val: number) => {
        const numVal = Number(val);
        return (
          <Tag color={numVal >= 90 ? "green" : numVal >= 70 ? "orange" : "red"}>
            {numVal.toFixed(1)}%
          </Tag>
        );
      },
    },
  ];

  const stepColumns = [
    {
      title: "用户",
      dataIndex: "user_id",
      key: "user_id",
      render: (_: string, record: UserStepStats) => (
        renderUserName(record.user_id, record.user_nickname, () => showUserDetail(record.user_id))
      ),
    },
    // 组织 ID 列暂时隐藏（目前只有个人模式数据）
    // {
    //   title: "组织 ID",
    //   dataIndex: "org_id",
    //   key: "org_id",
    //   render: (text?: string) => text ? <Tag color="blue">{text.slice(0, 8)}...</Tag> : "-",
    // },
    // 模式列暂时隐藏（目前只有个人模式数据）
    // {
    //   title: "模式",
    //   dataIndex: "login_mode",
    //   key: "login_mode",
    //   render: (text?: string) => (
    //     <Tag color={text === "enterprise" ? "purple" : text === "personal" ? "cyan" : "default"}>
    //       {text === "enterprise" ? <TeamOutlined /> : <PersonalOutlined />} {text ? loginModeLabels[text] : "-"}
    //     </Tag>
    //   ),
    // },
    {
      title: "Step 类型",
      dataIndex: "step_type",
      key: "step_type",
      render: (text: string) => {
        const colorMap: Record<string, string> = {
          tool_call: "blue",
          permission_request: "orange",
          file_operation: "green",
          thinking: "purple",
        };
        return <Tag color={colorMap[text] || "default"}>{stepTypeLabels[text] || text}</Tag>;
      },
    },
    {
      title: "数量",
      dataIndex: "step_count",
      key: "step_count",
      sorter: (a: UserStepStats, b: UserStepStats) => a.step_count - b.step_count,
    },
    {
      title: "成功",
      dataIndex: "success_count",
      key: "success_count",
    },
    {
      title: "错误",
      dataIndex: "error_count",
      key: "error_count",
      render: (val: number) => val > 0 ? <Tag color="red">{val}</Tag> : <Tag color="green">0</Tag>,
    },
    {
      title: "成功率",
      dataIndex: "success_rate",
      key: "success_rate",
      render: (val: number) => {
        const numVal = Number(val);
        return (
          <Tag color={numVal >= 90 ? "green" : numVal >= 70 ? "orange" : "red"}>
            {numVal.toFixed(1)}%
          </Tag>
        );
      },
    },
  ];

  const leaderboardColumns = (title: string) => [
    {
      title: "排名",
      dataIndex: "rank",
      key: "rank",
      width: 60,
      render: (val: number) => {
        const color = val === 1 ? "#FFD700" : val === 2 ? "#C0C0C0" : val === 3 ? "#CD7F32" : undefined;
        return (
          <span style={{ color, fontWeight: val <= 3 ? "bold" : "normal" }}>
            {val <= 3 && <TrophyOutlined />} {val}
          </span>
        );
      },
    },
    {
      title: "用户",
      dataIndex: "user_id",
      key: "user_id",
      render: (_: string, record: UserLeaderboardEntry) => (
        renderUserName(record.user_id, record.user_nickname, () => showUserDetail(record.user_id))
      ),
    },
    {
      title: title,
      dataIndex: "value",
      key: "value",
      width: 100,
      render: (val: number) => <strong>{val.toLocaleString()}</strong>,
    },
  ];

  return (
    <div>
      {/* Header with time range selector */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col>
          <TimeRangeFilter
            value={timeRange}
            activePreset={activePreset}
            onChange={setTimeRange}
            onPresetChange={applyPreset}
            format="YYYY-MM-DD"
          />
        </Col>
      </Row>

      {/* User Overview */}
      <Card style={{ marginBottom: 16 }}>
        <Spin spinning={realtimeLoading}>
          <Row gutter={16}>
            <Col span={24} style={{ marginBottom: 16 }}>
              <span style={{ fontWeight: 500 }}>
                用户概览
                <Tooltip title="实时数据：来自原始数据表，反映当前状态">
                  <ThunderboltOutlined style={{ marginLeft: 8, color: "#52c41a" }} />
                </Tooltip>
              </span>
            </Col>
            <Col xs={24} sm={12} md={4}>
              <Statistic
                title="总用户"
                value={realtimeStats?.total_users || 0}
                suffix="人"
              />
            </Col>
            <Col xs={24} sm={12} md={5}>
              <Statistic
                title="总会话"
                value={realtimeStats?.total_conversations || 0}
                suffix="次"
              />
            </Col>
            <Col xs={24} sm={12} md={5}>
              <Statistic
                title="总Turn"
                value={realtimeStats?.total_turns || 0}
                suffix="次"
              />
            </Col>
            <Col xs={24} sm={12} md={5}>
              <Statistic
                title="总Step"
                value={realtimeStats?.total_steps || 0}
                suffix="次"
              />
            </Col>
            <Col xs={24} sm={12} md={5}>
              <Statistic
                title="总Tokens消耗"
                value={realtimeStats?.total_tokens || 0}
              />
            </Col>
          </Row>
        </Spin>
      </Card>

      {/* Leaderboard */}
      <Card
        title={
          <Space>
            <TrophyOutlined />
            <span>排行榜 Top 10</span>
          </Space>
        }
        extra={
          <Select
            value={leaderboardOrder}
            onChange={setLeaderboardOrder}
            options={[
              { label: "最高", value: "desc" },
              { label: "最低", value: "asc" },
            ]}
            style={{ width: 80 }}
          />
        }
        style={{ marginBottom: 16 }}
      >
        <Spin spinning={leaderboardLoading}>
          <Row gutter={16}>
            <Col span={12}>
              <Table
                title={() => (
                  <div style={{ backgroundColor: "#f0f5ff", padding: "8px 12px", margin: "-8px -8px 8px -8px", fontWeight: 500 }}>
                    会话数
                  </div>
                )}
                dataSource={leaderboardData.conversations}
                columns={leaderboardColumns("会话数")}
                rowKey="user_id"
                pagination={false}
                size="small"
              />
            </Col>
            <Col span={12}>
              <Table
                title={() => (
                  <div style={{ backgroundColor: "#fff7e6", padding: "8px 12px", margin: "-8px -8px 8px -8px", fontWeight: 500 }}>
                    Turn 数
                  </div>
                )}
                dataSource={leaderboardData.turns}
                columns={leaderboardColumns("Turn 数")}
                rowKey="user_id"
                pagination={false}
                size="small"
              />
            </Col>
          </Row>
          <Row gutter={16} style={{ marginTop: 16 }}>
            <Col span={12}>
              <Table
                title={() => (
                  <div style={{ backgroundColor: "#f6ffed", padding: "8px 12px", margin: "-8px -8px 8px -8px", fontWeight: 500 }}>
                    Step 数
                  </div>
                )}
                dataSource={leaderboardData.steps}
                columns={leaderboardColumns("Step 数")}
                rowKey="user_id"
                pagination={false}
                size="small"
              />
            </Col>
            <Col span={12}>
              <Table
                title={() => (
                  <div style={{ backgroundColor: "#fff0f6", padding: "8px 12px", margin: "-8px -8px 8px -8px", fontWeight: 500 }}>
                    Tokens
                  </div>
                )}
                dataSource={leaderboardData.tokens}
                columns={leaderboardColumns("Tokens")}
                rowKey="user_id"
                pagination={false}
                size="small"
              />
            </Col>
          </Row>
        </Spin>
      </Card>

      {/* Main Stats Table */}
      <Card title="详细统计">
        <Space direction="vertical" style={{ width: "100%" }} size="large">
          <Row gutter={16}>
            <Col>
              <Segmented
                value={activeTab}
                onChange={(val) => setActiveTab(val as StatsTab)}
                options={[
                  { label: "会话统计", value: "conversations" },
                  { label: "Turn 统计", value: "turns" },
                  { label: "Step 统计", value: "steps" },
                ]}
              />
            </Col>
            {activeTab === "steps" && (
              <Col>
                <Select
                  value={stepTypeFilter}
                  onChange={setStepTypeFilter}
                  placeholder="按 Step 类型筛选"
                  allowClear
                  options={[
                    { label: "工具调用", value: "tool_call" },
                    { label: "权限请求", value: "permission_request" },
                    { label: "文件操作", value: "file_operation" },
                    { label: "思考", value: "thinking" },
                  ]}
                  style={{ width: 200 }}
                />
              </Col>
            )}
          </Row>

          <Spin spinning={loading}>
            {activeTab === "conversations" && (
              <Table
                dataSource={conversationData}
                columns={conversationColumns}
                rowKey="user_id"
                pagination={{ pageSize: 20 }}
              />
            )}
            {activeTab === "turns" && (
              <Table
                dataSource={turnData}
                columns={turnColumns}
                rowKey="user_id"
                pagination={{ pageSize: 20 }}
              />
            )}
            {activeTab === "steps" && (
              <Table
                dataSource={stepData}
                columns={stepColumns}
                rowKey={(record) => `${record.user_id}-${record.step_type}`}
                pagination={{ pageSize: 20 }}
              />
            )}
          </Spin>
        </Space>
      </Card>

      {/* User Detail Modal */}
      <Modal
        title={`用户详情: ${userDetail?.user_nickname || selectedUserId?.slice(0, 8) || ''}`}
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={700}
      >
        <Spin spinning={detailLoading}>
          {userDetail && (
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Card title="会话统计" size="small">
                  <Statistic title="总数" value={userDetail.conversations.conversation_count || 0} />
                  <Statistic title="平均时长" value={`${((userDetail.conversations.avg_duration_ms || 0) / 1000).toFixed(1)}s`} />
                  <Statistic title="成功率" value={`${Number(userDetail.conversations.success_rate || 0).toFixed(1)}%`} />
                </Card>
              </Col>
              <Col span={12}>
                <Card title="Turn 统计" size="small">
                  <Statistic title="总数" value={userDetail.turns.turn_count || 0} />
                  <Statistic title="总 Tokens" value={userDetail.turns.total_tokens || 0} />
                  <Statistic title="平均 Tokens/Turn" value={userDetail.turns.avg_tokens_per_turn || 0} />
                </Card>
              </Col>
              <Col span={12}>
                <Card title="按 Step 类型" size="small">
                  {userDetail.steps.map((s) => (
                    <Tag key={s.step_type} color="blue">
                      {stepTypeLabels[s.step_type] || s.step_type}: {s.count} ({Number(s.success_rate).toFixed(0)}%)
                    </Tag>
                  ))}
                </Card>
              </Col>
              <Col span={12}>
                <Card title="常用模型" size="small">
                  {userDetail.model_usage.map((m) => (
                    <Tag key={m.model_id} color="green">
                      {m.model_id}: {m.count}
                    </Tag>
                  ))}
                </Card>
              </Col>
            </Row>
          )}
        </Spin>
      </Modal>
    </div>
  );
}
