/**
 * Conversations analysis page with error statistics
 */

import React, { useState, useEffect } from "react";
import { Card, Table, Tag, Spin, Row, Col, Progress, Select, Tooltip, Statistic, Segmented } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/qms/client";
import { StatCard, TimeRangeFilter } from "../../components/qms";
import { getErrorCodeDefinition } from "../../constants/qms/error-codes";
import { useCachedTimeRange, useQmsTenantFilter } from "../../hooks/qms";

interface ConversationDailyData {
  date: string;
  platform?: string;
  arch?: string;
  version?: string;
  success_count: number;
  error_count: number;
  user_cancel_count: number;
  total_count: number;
  avg_duration_ms: number;
  avg_tokens: number | null;
  success_rate: number;
}

interface ErrorDailyData {
  date: string;
  error_code: string;
  count: number;
}

interface ConversationDimensions {
  platforms: { platform: string; arch: string; label: string; value: string }[];
  versions: string[];
}

// Platform color map
const platformColorMap: Record<string, string> = {
  "win32": "blue",
  "darwin": "cyan",
};

// Platform display helper
const getPlatformLabel = (platform?: string, arch?: string): string => {
  if (!platform) return "-";
  if (platform === "win32" && arch === "x64") return "Windows X64";
  if (platform === "win32" && arch === "x86") return "Windows X86";
  if (platform === "darwin" && arch === "x64") return "macOS Intel";
  if (platform === "darwin" && arch === "arm64") return "macOS ARM";
  return `${platform} ${arch || ""}`;
};

export default function Conversations() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStartTime = Number(searchParams.get("start_time"));
  const initialEndTime = Number(searchParams.get("end_time"));
  const [loading, setLoading] = useState(true);
  const [errorLoading, setErrorLoading] = useState(true);
  const [data, setData] = useState<ConversationDailyData[]>([]);
  const [errorData, setErrorData] = useState<ErrorDailyData[]>([]);
  const [dimensions, setDimensions] = useState<ConversationDimensions>({ platforms: [], versions: [] });
  const initialTimeRange: [number, number] | undefined =
    Number.isFinite(initialStartTime) && initialStartTime > 0 && Number.isFinite(initialEndTime) && initialEndTime > initialStartTime
      ? [initialStartTime, initialEndTime]
      : undefined;
  const { timeRange, activePreset, setTimeRange, applyPreset } = useCachedTimeRange("conversations", {
    initialRange: initialTimeRange,
  });
  const tenantFilter = useQmsTenantFilter();
  const [selectedErrorCode, setSelectedErrorCode] = useState<string>("all");
  const [selectedDimension, setSelectedDimension] = useState<string>("all");

  useEffect(() => {
    fetchDimensions();
  }, [timeRange, tenantFilter]);

  useEffect(() => {
    fetchData();
  }, [timeRange, selectedDimension, tenantFilter]);

  useEffect(() => {
    setSearchParams(
      {
        start_time: timeRange[0].toString(),
        end_time: timeRange[1].toString(),
      },
      { replace: true }
    );
  }, [timeRange, setSearchParams]);

  const fetchDimensions = async () => {
    try {
      const result = await api.getConversationDimensions(timeRange[0], timeRange[1]);
      setDimensions(result);
    } catch (err) {
      console.error("Failed to fetch dimensions:", err);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setErrorLoading(true);
    try {
      const [convResult, errorResult] = await Promise.all([
        api.getConversationTrend(timeRange[0], timeRange[1], selectedDimension),
        api.getConversationErrorTrend(timeRange[0], timeRange[1]),
      ]);
      setData(convResult as ConversationDailyData[]);
      setErrorData(errorResult as ErrorDailyData[]);
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
      setErrorLoading(false);
    }
  };

  // Calculate conversation summary
  const totalConversations = data.reduce((sum, d) => sum + d.total_count, 0);
  const totalSuccess = data.reduce((sum, d) => sum + d.success_count, 0);
  const totalErrors = data.reduce((sum, d) => sum + d.error_count, 0);
  const totalCancels = data.reduce((sum, d) => sum + d.user_cancel_count, 0);
  const avgDuration = data.length > 0
    ? Math.round(data.reduce((sum, d) => sum + d.avg_duration_ms, 0) / data.length)
    : 0;
  const avgTokens = data.length > 0 && data[0]?.avg_tokens
    ? Math.round(data.reduce((sum, d) => sum + (d.avg_tokens || 0), 0) / data.length)
    : 0;
  const overallSuccessRate = totalConversations > 0
    ? Math.round((totalSuccess / totalConversations) * 100)
    : 0;
  const overallErrorRate = totalConversations > 0
    ? Math.round((totalErrors / totalConversations) * 100)
    : 0;

  // Error statistics
  const errorCodes = [...new Set(errorData.map((d) => d.error_code))];
  const filteredErrorData = selectedErrorCode === "all"
    ? errorData
    : errorData.filter((d) => d.error_code === selectedErrorCode);

  // Total error count from error_data
  const totalErrorEvents = filteredErrorData.reduce((sum, d) => sum + d.count, 0);
  const uniqueErrorCodes = errorCodes.length;

  // Group by error code for summary
  const errorSummary = errorData.reduce((acc, d) => {
    acc[d.error_code] = (acc[d.error_code] ?? 0) + d.count;
    return acc;
  }, {} as Record<string, number>);

  const topErrors = Object.entries(errorSummary)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Upstream component color map
  const upstreamColorMap: Record<string, string> = {
    "nova-gateway": "blue",
    "acp": "cyan",
    "openclaw": "green",
    "sudoclaw": "purple",
    "llm": "magenta",
    "client": "orange",
  };

  // Error type bucket interface
  interface ErrorTypeBucket {
    type: string;
    location: string;
    upstream: string;
    trigger: string;
    count: number;
    codes: string[];
  }

  // Group by error type (using error-codes.ts definitions)
  const errorTypeBuckets = React.useMemo(() => {
    const bucketMap = new Map<string, ErrorTypeBucket>();

    for (const [code, count] of topErrors) {
      const definition = getErrorCodeDefinition(code);
      if (definition) {
        const existing = bucketMap.get(definition.type);
        if (existing) {
          existing.count += count;
          existing.codes.push(code);
        } else {
          bucketMap.set(definition.type, {
            type: definition.type,
            location: definition.location,
            upstream: definition.upstream_component,
            trigger: definition.trigger_scenario,
            count: count,
            codes: [code],
          });
        }
      }
    }

    return Array.from(bucketMap.values()).sort((a, b) => b.count - a.count);
  }, [topErrors]);

  // Calculate summary stats by dimension (platform/version) from latest data
  const latestDataByGroup = React.useMemo(() => {
    const groupMap = new Map<string, ConversationDailyData>();
    const sortedData = [...data].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    for (const row of sortedData) {
      const key = selectedDimension === "platform"
        ? `${row.platform}|${row.arch}`
        : selectedDimension === "version"
        ? row.version || ""
        : "all";

      if (!groupMap.has(key)) {
        groupMap.set(key, row);
      }
    }
    return Array.from(groupMap.values());
  }, [data, selectedDimension]);

  // Group all data by dimension for aggregated stats
  const aggregatedByDimension = React.useMemo(() => {
    const groupMap = new Map<string, {
      platform?: string;
      arch?: string;
      version?: string;
      success: number;
      error: number;
      cancel: number;
      total: number;
      avgDuration: number;
      avgTokens: number;
    }>();

    for (const row of data) {
      const key = selectedDimension === "platform"
        ? `${row.platform}|${row.arch}`
        : selectedDimension === "version"
        ? row.version || ""
        : "all";

      const existing = groupMap.get(key);
      if (existing) {
        existing.success += row.success_count;
        existing.error += row.error_count;
        existing.cancel += row.user_cancel_count;
        existing.total += row.total_count;
        existing.avgDuration += row.avg_duration_ms;
        existing.avgTokens += row.avg_tokens || 0;
      } else {
        groupMap.set(key, {
          platform: row.platform,
          arch: row.arch,
          version: row.version,
          success: row.success_count,
          error: row.error_count,
          cancel: row.user_cancel_count,
          total: row.total_count,
          avgDuration: row.avg_duration_ms,
          avgTokens: row.avg_tokens || 0,
        });
      }
    }

    return Array.from(groupMap.values()).map(item => ({
      ...item,
      successRate: item.success + item.error > 0 ? Math.round((item.success / (item.success + item.error)) * 100) : 100,
      avgDuration: Math.round(item.avgDuration / data.filter(d =>
        selectedDimension === "platform" ? `${d.platform}|${d.arch}` === `${item.platform}|${item.arch}` :
        selectedDimension === "version" ? d.version === item.version : true
      ).length),
    }));
  }, [data, selectedDimension]);

  const conversationColumns = [
    {
      title: "日期",
      dataIndex: "date",
      key: "date",
      sorter: true,
    },
    ...(selectedDimension === "platform" ? [
      {
        title: "平台",
        key: "platform_display",
        render: (_: unknown, record: ConversationDailyData) => (
          <Tag color={platformColorMap[record.platform || ""] || "default"}>
            {getPlatformLabel(record.platform, record.arch)}
          </Tag>
        ),
      },
    ] : []),
    ...(selectedDimension === "version" ? [
      {
        title: "版本",
        dataIndex: "version",
        key: "version",
        render: (version: string) => <Tag>{version}</Tag>,
      },
    ] : []),
    {
      title: "成功",
      dataIndex: "success_count",
      key: "success_count",
      render: (v: number) => <Tag color="green">{v}</Tag>,
      sorter: true,
    },
    {
      title: "错误",
      dataIndex: "error_count",
      key: "error_count",
      render: (v: number) => <Tag color="red">{v}</Tag>,
      sorter: true,
    },
    {
      title: "取消",
      dataIndex: "user_cancel_count",
      key: "user_cancel_count",
      render: (v: number) => <Tag color="orange">{v}</Tag>,
      sorter: true,
    },
    {
      title: "总数",
      dataIndex: "total_count",
      key: "total_count",
      sorter: true,
    },
    {
      title: "成功率",
      dataIndex: "success_rate",
      key: "success_rate",
      render: (rate: number) => (
        <Progress
          percent={rate}
          size="small"
          status={rate >= 95 ? "success" : rate >= 80 ? "normal" : "exception"}
        />
      ),
      sorter: true,
    },
    {
      title: "平均时长",
      dataIndex: "avg_duration_ms",
      key: "avg_duration_ms",
      render: (v: number) => `${v}ms`,
      sorter: true,
    },
    {
      title: "平均Token",
      dataIndex: "avg_tokens",
      key: "avg_tokens",
      render: (v: number | null) => v || "-",
      sorter: true,
    },
  ];

  const errorTrendColumns = [
    {
      title: "日期",
      dataIndex: "date",
      key: "date",
      sorter: true,
    },
    {
      title: "错误码",
      dataIndex: "error_code",
      key: "error_code",
      render: (code: string) => {
        const definition = getErrorCodeDefinition(code);
        const color = definition ? upstreamColorMap[definition.upstream_component] || "red" : "red";
        return (
          <Tooltip title={definition?.type || code}>
            <Tag color={color}>{code}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: "错误类型",
      dataIndex: "error_code",
      key: "type",
      render: (code: string) => {
        const definition = getErrorCodeDefinition(code);
        return definition?.type || "-";
      },
    },
    {
      title: "次数",
      dataIndex: "count",
      key: "count",
      sorter: true,
      render: (count: number) => (
        <span style={{ color: count > 10 ? "#f5222d" : "#666" }}>{count}</span>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col>
          <TimeRangeFilter
            value={timeRange}
            activePreset={activePreset}
            onChange={setTimeRange}
            onPresetChange={applyPreset}
          />
        </Col>
        <Col>
          <Segmented
            value={selectedDimension}
            onChange={(value) => setSelectedDimension(value as string)}
            options={[
              { label: "全部", value: "all" },
              { label: "按平台", value: "platform" },
              { label: "按版本", value: "version" },
            ]}
          />
        </Col>
      </Row>

      {loading ? (
        <div style={{ textAlign: "center", padding: 100 }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          {/* Conversation Summary Cards */}
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={4}>
              <StatCard title="对话总数" value={totalConversations} color="normal" freshness="aggregated" />
            </Col>
            <Col span={4}>
              <StatCard title="成功数" value={totalSuccess} color="success" freshness="aggregated" />
            </Col>
            <Col span={4}>
              <StatCard title="错误数" value={totalErrors} color="error" freshness="aggregated" />
            </Col>
            <Col span={4}>
              <StatCard title="取消数" value={totalCancels} color="warning" freshness="aggregated" />
            </Col>
            <Col span={4}>
              <StatCard title="成功率" value={overallSuccessRate} suffix="%" color="success" freshness="aggregated" />
            </Col>
            <Col span={4}>
              <StatCard title="平均时长" value={avgDuration} suffix="ms" freshness="aggregated" />
            </Col>
          </Row>

          {/* Dimension Statistics */}
          {(selectedDimension === "platform" || selectedDimension === "version") && aggregatedByDimension.length > 0 && (
            <Card
              title={
                <span>
                  {selectedDimension === "platform" ? "平台统计" : "版本统计"}
                  <Tooltip title="按维度聚合的对话统计">
                    <InfoCircleOutlined style={{ marginLeft: 8, color: "#999" }} />
                  </Tooltip>
                </span>
              }
              style={{ marginBottom: 16 }}
            >
              {aggregatedByDimension.map((item) => (
                <Card
                  key={selectedDimension === "platform" ? `${item.platform}|${item.arch}` : item.version}
                  size="small"
                  style={{ marginBottom: 16 }}
                >
                  <Row gutter={24}>
                    <Col span={4}>
                      <Tooltip title={selectedDimension === "platform" ? getPlatformLabel(item.platform, item.arch) : item.version}>
                        <Tag
                          color={selectedDimension === "platform" ? platformColorMap[item.platform || ""] || "default" : "blue"}
                          style={{ fontSize: 14, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}
                        >
                          {selectedDimension === "platform" ? getPlatformLabel(item.platform, item.arch) : item.version}
                        </Tag>
                      </Tooltip>
                    </Col>
                    <Col span={3}>
                      <Statistic title="成功" value={item.success} valueStyle={{ fontSize: 18, color: "#52c41a" }} />
                    </Col>
                    <Col span={3}>
                      <Statistic title="错误" value={item.error} valueStyle={{ fontSize: 18, color: "#ff4d4f" }} />
                    </Col>
                    <Col span={3}>
                      <Statistic title="取消" value={item.cancel} valueStyle={{ fontSize: 18, color: "#faad14" }} />
                    </Col>
                    <Col span={3}>
                      <Statistic title="总数" value={item.total} valueStyle={{ fontSize: 18 }} />
                    </Col>
                    <Col span={5}>
                      <Statistic title="成功率" value={item.successRate} suffix="%" valueStyle={{ fontSize: 18, color: item.successRate >= 95 ? "#52c41a" : item.successRate >= 80 ? "#1890ff" : "#ff4d4f" }} />
                    </Col>
                    <Col span={6}>
                      <Statistic title="平均时长" value={item.avgDuration} suffix="ms" valueStyle={{ fontSize: 18 }} />
                    </Col>
                  </Row>
                </Card>
              ))}
            </Card>
          )}

          {/* Error Statistics Section */}
          {totalErrors > 0 && (
            <>
              <Card title="错误统计" style={{ marginBottom: 16 }}>
                <Row gutter={16}>
                  <Col span={4}>
                    <StatCard title="错误事件总数" value={totalErrorEvents} color="error" />
                  </Col>
                  <Col span={4}>
                    <StatCard title="错误类型数" value={uniqueErrorCodes} color="normal" />
                  </Col>
                  <Col span={4}>
                    <StatCard title="错误率" value={overallErrorRate} suffix="%" color="error" />
                  </Col>
                </Row>
              </Card>

              {/* Error Type Buckets and Top Errors */}
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={12}>
                  <Card
                    title={
                      <span>
                        错误类型分桶
                        <Tooltip title="按错误类型聚合，显示代码路径、上游组件和触发场景">
                          <InfoCircleOutlined style={{ marginLeft: 8, color: "#999" }} />
                        </Tooltip>
                      </span>
                    }
                  >
                    <Table
                      dataSource={errorTypeBuckets}
                      columns={[
                        {
                          title: "错误类型",
                          dataIndex: "type",
                          key: "type",
                          width: 150,
                          render: (type: string, record: ErrorTypeBucket) => (
                            <Tooltip title={`错误码: ${record.codes.join(", ")}`}>
                              <span style={{ cursor: "help" }}>{type}</span>
                            </Tooltip>
                          ),
                        },
                        {
                          title: "上游组件",
                          dataIndex: "upstream",
                          key: "upstream",
                          width: 100,
                          render: (upstream: string) => (
                            <Tag color={upstreamColorMap[upstream] || "default"}>{upstream}</Tag>
                          ),
                        },
                        {
                          title: "代码路径",
                          dataIndex: "location",
                          key: "location",
                          width: 150,
                          ellipsis: true,
                          render: (location: string) => (
                            <Tooltip title={location}>
                              <span style={{ color: "#1890ff" }}>{location}</span>
                            </Tooltip>
                          ),
                        },
                        {
                          title: "次数",
                          dataIndex: "count",
                          key: "count",
                          width: 80,
                          sorter: true,
                        },
                      ]}
                      rowKey="type"
                      pagination={false}
                      size="small"
                      expandable={{
                        expandedRowRender: (record: ErrorTypeBucket) => (
                          <div style={{ padding: 8 }}>
                            <p style={{ marginBottom: 8 }}>
                              <strong>触发场景：</strong>{record.trigger}
                            </p>
                            <p style={{ marginBottom: 0 }}>
                              <strong>相关错误码：</strong>{record.codes.join(", ")}
                            </p>
                          </div>
                        ),
                      }}
                    />
                  </Card>
                </Col>
                <Col span={12}>
                  <Card title="TOP 10 错误码">
                    <Table
                      dataSource={topErrors.map(([code, count]) => {
                        const definition = getErrorCodeDefinition(code);
                        return {
                          code,
                          count,
                          type: definition?.type || "-",
                          upstream: definition?.upstream_component || "-",
                        };
                      })}
                      columns={[
                        {
                          title: "错误码",
                          dataIndex: "code",
                          key: "code",
                          width: 80,
                          render: (code: string, record: { upstream: string }) => (
                            <Tag color={upstreamColorMap[record.upstream] || "red"}>{code}</Tag>
                          ),
                        },
                        {
                          title: "错误类型",
                          dataIndex: "type",
                          key: "type",
                          width: 150,
                          ellipsis: true,
                        },
                        {
                          title: "上游",
                          dataIndex: "upstream",
                          key: "upstream",
                          width: 100,
                          render: (upstream: string) => (
                            <Tag color={upstreamColorMap[upstream] || "default"}>{upstream}</Tag>
                          ),
                        },
                        {
                          title: "总次数",
                          dataIndex: "count",
                          key: "count",
                          width: 80,
                          sorter: true,
                        },
                      ]}
                      rowKey="code"
                      pagination={false}
                      size="small"
                    />
                  </Card>
                </Col>
              </Row>

              {/* Error Trend Table */}
              <Card title="错误趋势">
                <Row gutter={16} style={{ marginBottom: 16 }}>
                  <Col>
                    <Select
                      value={selectedErrorCode}
                      onChange={setSelectedErrorCode}
                      style={{ width: 200 }}
                      options={[
                        { value: "all", label: "全部错误" },
                        ...errorCodes.map((code) => ({ value: code, label: code })),
                      ]}
                    />
                  </Col>
                </Row>
                <Table
                  dataSource={filteredErrorData}
                  columns={errorTrendColumns}
                  rowKey={(record) => `${record.date}-${record.error_code}`}
                  pagination={{ pageSize: 20 }}
                  size="small"
                />
              </Card>
            </>
          )}

          {/* Conversation Trend */}
          <Card title="对话趋势" style={{ marginTop: 16 }}>
            <Table
              dataSource={data}
              columns={conversationColumns}
              rowKey={(record) => `${record.date}-${record.platform}-${record.arch}-${record.version}`}
              pagination={{ pageSize: 20 }}
              size="small"
            />
          </Card>
        </>
      )}
    </div>
  );
}
