/**
 * System settings page (Admin only)
 */

import React, { useState, useEffect } from "react";
import {
  Card,
  Descriptions,
  Spin,
  Row,
  Col,
  Statistic,
  Form,
  Input,
  Button,
  message,
  Space,
  InputNumber,
  Collapse,
  Table,
  Tag,
} from "antd";
import { SaveOutlined, SendOutlined, PlayCircleOutlined, ReloadOutlined, DatabaseOutlined, HistoryOutlined } from "@ant-design/icons";
import { api } from "../../api/qms/client";
import type { SystemStats } from "../../api/qms/types";
import dayjs from "dayjs";

interface NotificationConfig {
  lark: { webhookUrl: string };
  email: {
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPass: string;
    from: string;
    to: string;
  };
}

interface ScheduledTask {
  name: string;
  last_run: number | null;
  next_run: number;
  running: boolean;
  last_error: string | null;
}

interface RawStat {
  table: string;
  label: string;
  count: number;
  earliest: string | null;
  latest: string | null;
}

interface ErrorCodeDefinition {
  code: string;
  type: string;
  location: string;
  upstream_component: string;
  trigger_scenario: string;
}

const SHOW_SYSTEM_STATUS = false;
const SHOW_MEMORY_DETAILS = false;
const SHOW_NOTIFICATION_CONFIG = false;

export default function System() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [notificationConfig, setNotificationConfig] = useState<NotificationConfig | null>(null);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [rawStats, setRawStats] = useState<RawStat[]>([]);
  const [errorCodes, setErrorCodes] = useState<ErrorCodeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"lark" | "email" | null>(null);
  const [testing, setTesting] = useState<"lark" | "email" | null>(null);
  const [runningAggregation, setRunningAggregation] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [larkForm] = Form.useForm();
  const [emailForm] = Form.useForm();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsResult, notifResult, tasksResult, rawStatsResult, errorCodesResult] = await Promise.all([
        api.getSystemStats(),
        api.getNotificationConfig(),
        api.getScheduledTasks(),
        api.getRawStats(),
        api.getErrorCodeDefinitions(),
      ]);
      setStats(statsResult);
      setNotificationConfig(notifResult);
      setTasks(tasksResult);
      setRawStats(rawStatsResult);
      setErrorCodes(errorCodesResult);
      larkForm.setFieldsValue({ webhookUrl: notifResult.lark.webhookUrl });
      emailForm.setFieldsValue(notifResult.email);
    } catch (err) {
      console.error("Failed to fetch system data:", err);
    } finally {
      setLoading(false);
    }
  };

  // Format memory size
  const formatBytes = (bytes: number) => {
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(2)} MB`;
  };

  const handleSaveLark = async (values: { webhookUrl: string }) => {
    setSaving("lark");
    try {
      await api.updateNotificationConfig({ lark: values });
      message.success("飞书配置已保存");
      fetchData();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(null);
    }
  };

  const handleSaveEmail = async (values: NotificationConfig["email"]) => {
    setSaving("email");
    try {
      await api.updateNotificationConfig({ email: values });
      message.success("邮件配置已保存");
      fetchData();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(null);
    }
  };

  const handleTestNotification = async (channel: "lark" | "email") => {
    setTesting(channel);
    try {
      await api.testNotification(channel);
      message.success(`测试通知已发送到${channel === "lark" ? "飞书" : "邮件"}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "测试失败");
    } finally {
      setTesting(null);
    }
  };

  const handleRunAggregation = async () => {
    setRunningAggregation(true);
    try {
      const result = await api.runAggregationTasks();
      const failedTasks = result.results.filter((r) => !r.success);
      if (failedTasks.length === 0) {
        message.success("所有聚合任务执行成功");
      } else {
        message.warning(`部分任务执行失败: ${failedTasks.map((t) => t.task).join(", ")}`);
      }
      // Refresh task status and raw stats
      const [tasksResult, rawStatsResult] = await Promise.all([
        api.getScheduledTasks(),
        api.getRawStats(),
      ]);
      setTasks(tasksResult);
      setRawStats(rawStatsResult);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "聚合任务执行失败");
    } finally {
      setRunningAggregation(false);
    }
  };

  const handleBackfill = async (days: number) => {
    setBackfilling(true);
    try {
      await api.backfillAggregation(days);
      message.success(`历史数据回填完成，已聚合最近 ${days} 天的数据`);
      // Refresh stats
      const [tasksResult, rawStatsResult] = await Promise.all([
        api.getScheduledTasks(),
        api.getRawStats(),
      ]);
      setTasks(tasksResult);
      setRawStats(rawStatsResult);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "历史数据回填失败");
    } finally {
      setBackfilling(false);
    }
  };

  // Format task name for display
  const formatTaskName = (name: string) => {
    const nameMap: Record<string, string> = {
      "queue-process": "队列处理",
      "aggregation-refresh": "遥测数据聚合",
      "session-cleanup": "Session清理",
      "alert-check": "告警检查",
      "crash-aggregation": "崩溃数据聚合",
      "crash-cleanup": "崩溃数据清理",
    };
    return nameMap[name] || name;
  };

  // Get aggregation tasks only
  const aggregationTasks = tasks.filter(
    (t) => t.name === "aggregation-refresh" || t.name === "crash-aggregation"
  );

  const collapseItems = [
    {
      key: "lark",
      label: "飞书",
      children: (
        <Form
          form={larkForm}
          layout="vertical"
          onFinish={handleSaveLark}
          initialValues={{ webhookUrl: notificationConfig?.lark?.webhookUrl || "" }}
        >
          <Form.Item name="webhookUrl" label="Webhook URL">
            <Input placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
          </Form.Item>
          <Space>
            <Button type="primary" icon={<SaveOutlined />} loading={saving === "lark"} htmlType="submit">
              保存配置
            </Button>
            <Button
              icon={<SendOutlined />}
              loading={testing === "lark"}
              onClick={() => handleTestNotification("lark")}
            >
              测试通知
            </Button>
          </Space>
        </Form>
      ),
    },
    {
      key: "email",
      label: "邮件",
      children: (
        <Form
          form={emailForm}
          layout="vertical"
          onFinish={handleSaveEmail}
          initialValues={notificationConfig?.email}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="smtpHost" label="SMTP 服务器">
                <Input placeholder="smtp.example.com" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="smtpPort" label="端口">
                <InputNumber min={1} max={65535} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="smtpUser" label="用户名">
                <Input placeholder="user@example.com" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="smtpPass" label="密码">
                <Input.Password placeholder="密码" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="from" label="发送者">
                <Input placeholder="noreply@example.com" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="to" label="接收者">
                <Input placeholder="admin@example.com" />
              </Form.Item>
            </Col>
          </Row>
          <Space>
            <Button type="primary" icon={<SaveOutlined />} loading={saving === "email"} htmlType="submit">
              保存配置
            </Button>
            <Button
              icon={<SendOutlined />}
              loading={testing === "email"}
              onClick={() => handleTestNotification("email")}
            >
              测试通知
            </Button>
          </Space>
        </Form>
      ),
    },
  ];

  return (
    <div>
      {loading ? (
        <div style={{ textAlign: "center", padding: 100 }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          {/* System Stats */}
          {SHOW_SYSTEM_STATUS && (
            <Card title="系统状态" style={{ marginBottom: 16 }}>
              <Row gutter={16}>
                <Col span={6}>
                  <Statistic title="版本" value={stats?.version || "-"} />
                </Col>
                <Col span={6}>
                  <Statistic title="平台" value={stats?.platform || "-"} />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="内存使用"
                    value={formatBytes(stats?.memory_usage?.heap_used || 0)}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="总内存"
                    value={formatBytes(stats?.memory_usage?.heap_total || 0)}
                  />
                </Col>
              </Row>
            </Card>
          )}

          {/* Memory Details */}
          {SHOW_MEMORY_DETAILS && (
            <Card title="内存详情" style={{ marginBottom: 16 }}>
              <Descriptions bordered column={2}>
                <Descriptions.Item label="RSS">
                  {formatBytes(stats?.memory_usage?.rss || 0)}
                </Descriptions.Item>
                <Descriptions.Item label="Heap Total">
                  {formatBytes(stats?.memory_usage?.heap_total || 0)}
                </Descriptions.Item>
                <Descriptions.Item label="Heap Used">
                  {formatBytes(stats?.memory_usage?.heap_used || 0)}
                </Descriptions.Item>
                <Descriptions.Item label="External">
                  {formatBytes(stats?.memory_usage?.external || 0)}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          )}

          {/* Aggregation Tasks */}
          <Card
            title="聚合任务"
            style={{ marginBottom: 16 }}
            extra={
              <Space>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={fetchData}
                  size="small"
                >
                  刷新状态
                </Button>
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  loading={runningAggregation}
                  onClick={handleRunAggregation}
                  size="small"
                >
                  立即执行
                </Button>
              </Space>
            }
          >
            <Table
              dataSource={aggregationTasks}
              rowKey="name"
              pagination={false}
              size="small"
              columns={[
                {
                  title: "任务名称",
                  dataIndex: "name",
                  key: "name",
                  render: (name: string) => formatTaskName(name),
                },
                {
                  title: "上次执行",
                  dataIndex: "last_run",
                  key: "last_run",
                  render: (time: number | null) =>
                    time ? dayjs(time).format("YYYY-MM-DD HH:mm:ss") : "-",
                },
                {
                  title: "下次执行",
                  dataIndex: "next_run",
                  key: "next_run",
                  render: (time: number) => dayjs(time).format("YYYY-MM-DD HH:mm:ss"),
                },
                {
                  title: "状态",
                  key: "status",
                  render: (_: unknown, record: ScheduledTask) => {
                    if (record.running) {
                      return <Tag color="processing">执行中</Tag>;
                    }
                    if (record.last_error) {
                      return <Tag color="error">异常</Tag>;
                    }
                    return <Tag color="success">正常</Tag>;
                  },
                },
                {
                  title: "错误信息",
                  dataIndex: "last_error",
                  key: "last_error",
                  render: (error: string | null) => error || "-",
                },
              ]}
            />
            <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
              说明：聚合任务将遥测数据和崩溃数据从原始表汇总到每日聚合表，用于Dashboard、趋势分析和用户统计展示。用户统计查询逻辑：历史数据从聚合表查询，今日数据从原始表实时查询。
            </div>
          </Card>

          {/* Data Statistics - Hidden for now */}
          {false && (
            <Card
              title="数据统计"
              style={{ marginBottom: 16 }}
              extra={
                <Space>
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={fetchData}
                    size="small"
                  >
                    刷新
                  </Button>
                  <Button
                    type="primary"
                    icon={<HistoryOutlined />}
                    loading={backfilling}
                    onClick={() => handleBackfill(7)}
                    size="small"
                  >
                    回填历史（7天）
                  </Button>
                </Space>
              }
            >
              <Table
                dataSource={rawStats}
                rowKey="table"
                pagination={false}
                size="small"
                columns={[
                  {
                    title: "表名",
                    dataIndex: "label",
                    key: "label",
                  },
                  {
                    title: "记录数",
                    dataIndex: "count",
                    key: "count",
                    render: (count: number) => (
                      <span style={{ color: count === 0 ? "#f5222d" : "#52c41a", fontWeight: 500 }}>
                        {count}
                      </span>
                    ),
                  },
                  {
                    title: "最早数据",
                    dataIndex: "earliest",
                    key: "earliest",
                    render: (time: string | null) =>
                      time ? dayjs(time).format("YYYY-MM-DD HH:mm") : "-",
                  },
                  {
                    title: "最新数据",
                    dataIndex: "latest",
                    key: "latest",
                    render: (time: string | null) =>
                      time ? dayjs(time).format("YYYY-MM-DD HH:mm") : "-",
                  },
                ]}
              />
              <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
                说明：原始表存储实时上报的数据，聚合表存储每日汇总数据。如果聚合表数据为空或时间范围不足，可点击"回填历史"按钮补齐数据。
              </div>
            </Card>
          )}

          {/* Notification Config */}
          {SHOW_NOTIFICATION_CONFIG && (
            <Card title="通知配置" style={{ marginBottom: 16 }}>
              <Collapse items={collapseItems} />
            </Card>
          )}

          {/* Error Code Definitions */}
          <Card title="错误码定义" style={{ marginBottom: 16 }}>
            <Collapse
              items={[
                {
                  key: "error-codes",
                  label: "点击展开查看错误码定义",
                  children: (
                    <>
                      <Table
                        dataSource={errorCodes}
                        rowKey="code"
                        pagination={false}
                        size="small"
                        columns={[
                          {
                            title: "错误码",
                            dataIndex: "code",
                            key: "code",
                            width: 80,
                            render: (code: string) => <Tag color="red">{code}</Tag>,
                          },
                          {
                            title: "错误类型",
                            dataIndex: "type",
                            key: "type",
                            width: 150,
                          },
                          {
                            title: "定位代码",
                            dataIndex: "location",
                            key: "location",
                            width: 200,
                            render: (location: string) => (
                              <span style={{ color: "#1890ff", fontSize: 12 }}>{location}</span>
                            ),
                          },
                          {
                            title: "上游组件",
                            dataIndex: "upstream_component",
                            key: "upstream_component",
                            width: 120,
                            render: (component: string) => {
                              const colorMap: Record<string, string> = {
                                nova_gateway: "purple",
                                acp: "cyan",
                                openclaw: "geekblue",
                                client: "orange",
                                sudoclaw: "magenta",
                              };
                              return <Tag color={colorMap[component] || "default"}>{component}</Tag>;
                            },
                          },
                          {
                            title: "触发场景",
                            dataIndex: "trigger_scenario",
                            key: "trigger_scenario",
                            render: (scenario: string) => (
                              <span style={{ fontSize: 12 }}>{scenario}</span>
                            ),
                          },
                        ]}
                      />
                      <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
                        说明：以上错误码由客户端应用上报，用于分类统计各类错误的发生频率和影响范围。
                      </div>
                    </>
                  ),
                },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
