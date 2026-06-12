/**
 * Performance analysis page
 */

import React, { useState, useEffect } from "react";
import { Card, Spin, Row, Col, Select, Table, Tag, Segmented, Tooltip, Statistic } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { api } from "../../api/qms/client";
import { TimeRangeFilter } from "../../components/qms";
import { useCachedTimeRange, useQmsTenantFilter } from "../../hooks/qms";

interface PerfDailyData {
  date: string;
  metric: string;
  platform?: string;
  arch?: string;
  version?: string;
  p50: number;
  p90: number;
  p95: number;
  avg_value: number;
  count: number;
}

interface PerfDimensions {
  platforms: { platform: string; arch: string; label: string; value: string }[];
  versions: string[];
  metrics: string[];
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

export default function Performance() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PerfDailyData[]>([]);
  const [dimensions, setDimensions] = useState<PerfDimensions>({ platforms: [], versions: [], metrics: [] });
  const { timeRange, activePreset, setTimeRange, applyPreset } = useCachedTimeRange("performance");
  const tenantFilter = useQmsTenantFilter();
  const [selectedMetric, setSelectedMetric] = useState<string>("all");
  const [selectedDimension, setSelectedDimension] = useState<string>("all");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("all");
  const [selectedVersion, setSelectedVersion] = useState<string>("all");

  useEffect(() => {
    fetchDimensions();
  }, [timeRange, tenantFilter]);

  useEffect(() => {
    fetchData();
  }, [timeRange, selectedMetric, selectedDimension, selectedPlatform, selectedVersion, tenantFilter]);

  const fetchDimensions = async () => {
    try {
      const result = await api.getPerfDimensions(timeRange[0], timeRange[1]);
      setDimensions(result);
    } catch (err) {
      console.error("Failed to fetch dimensions:", err);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const params: {
        metric?: string;
        dimension?: string;
        platform?: string;
        arch?: string;
        version?: string;
      } = {};

      if (selectedMetric !== "all") {
        params.metric = selectedMetric;
      }

      if (selectedDimension !== "all") {
        params.dimension = selectedDimension;
      }

      if (selectedPlatform !== "all") {
        const [platform, arch] = selectedPlatform.split("|");
        params.platform = platform;
        params.arch = arch;
      }

      if (selectedVersion !== "all") {
        params.version = selectedVersion;
      }

      const result = await api.getPerfTrend(timeRange[0], timeRange[1], params);
      setData(result as PerfDailyData[]);
    } catch (err) {
      console.error("Failed to fetch perf data:", err);
    } finally {
      setLoading(false);
    }
  };

  // Calculate summary stats from latest data
  const latestDataByGroup = React.useMemo(() => {
    const groupMap = new Map<string, PerfDailyData>();
    const sortedData = [...data].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    for (const row of sortedData) {
      const key = selectedDimension === "platform"
        ? `${row.metric}|${row.platform}|${row.arch}`
        : selectedDimension === "version"
        ? `${row.metric}|${row.version}`
        : row.metric;

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
      metric: string;
      p50s: number[];
      p90s: number[];
      p95s: number[];
      avgs: number[];
      counts: number[];
    }>();

    for (const row of data) {
      const key = selectedDimension === "platform"
        ? `${row.metric}|${row.platform}|${row.arch}`
        : selectedDimension === "version"
        ? `${row.metric}|${row.version}`
        : row.metric;

      const existing = groupMap.get(key);
      if (existing) {
        existing.p50s.push(row.p50);
        existing.p90s.push(row.p90);
        existing.p95s.push(row.p95);
        existing.avgs.push(row.avg_value);
        existing.counts.push(row.count);
      } else {
        groupMap.set(key, {
          platform: row.platform,
          arch: row.arch,
          version: row.version,
          metric: row.metric,
          p50s: [row.p50],
          p90s: [row.p90],
          p95s: [row.p95],
          avgs: [row.avg_value],
          counts: [row.count],
        });
      }
    }

    return Array.from(groupMap.values()).map(item => ({
      ...item,
      avgP50: Math.round(item.p50s.reduce((a, b) => a + b, 0) / item.p50s.length),
      avgP90: Math.round(item.p90s.reduce((a, b) => a + b, 0) / item.p90s.length),
      avgP95: Math.round(item.p95s.reduce((a, b) => a + b, 0) / item.p95s.length),
      avgAvg: Math.round(item.avgs.reduce((a, b) => a + b, 0) / item.avgs.length),
      totalCount: item.counts.reduce((a, b) => a + b, 0),
    }));
  }, [data, selectedDimension]);

  const columns = [
    {
      title: "日期",
      dataIndex: "date",
      key: "date",
      width: 100,
    },
    {
      title: "指标",
      dataIndex: "metric",
      key: "metric",
      width: 150,
      render: (metric: string) => <Tag color="blue">{metric}</Tag>,
    },
    ...(selectedDimension === "platform" ? [
      {
        title: "平台",
        key: "platform_display",
        width: 120,
        render: (_: unknown, record: PerfDailyData) => (
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
        width: 100,
        render: (version: string) => <Tag>{version}</Tag>,
      },
    ] : []),
    {
      title: "P50",
      dataIndex: "p50",
      key: "p50",
      width: 80,
      render: (v: number) => `${v}ms`,
      sorter: true,
    },
    {
      title: "P90",
      dataIndex: "p90",
      key: "p90",
      width: 80,
      render: (v: number) => `${v}ms`,
      sorter: true,
    },
    {
      title: "P95",
      dataIndex: "p95",
      key: "p95",
      width: 80,
      render: (v: number) => `${v}ms`,
      sorter: true,
    },
    {
      title: "平均",
      dataIndex: "avg_value",
      key: "avg_value",
      width: 80,
      render: (v: number) => `${v}ms`,
      sorter: true,
    },
    {
      title: "样本数",
      dataIndex: "count",
      key: "count",
      width: 80,
      sorter: true,
    },
  ];

  // Summary table columns for dimension view
  const summaryColumns = [
    {
      title: "指标",
      dataIndex: "metric",
      key: "metric",
      render: (metric: string) => <Tag color="blue">{metric}</Tag>,
    },
    ...(selectedDimension === "platform" ? [
      {
        title: "平台",
        key: "platform_display",
        render: (_: unknown, record: { platform?: string; arch?: string }) => (
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
      title: "平均P50",
      dataIndex: "avgP50",
      key: "avgP50",
      render: (v: number) => `${v}ms`,
      sorter: true,
    },
    {
      title: "平均P90",
      dataIndex: "avgP90",
      key: "avgP90",
      render: (v: number) => `${v}ms`,
      sorter: true,
    },
    {
      title: "平均P95",
      dataIndex: "avgP95",
      key: "avgP95",
      render: (v: number) => `${v}ms`,
      sorter: true,
    },
    {
      title: "总样本",
      dataIndex: "totalCount",
      key: "totalCount",
      sorter: true,
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
            format="YYYY-MM-DD"
          />
        </Col>
        <Col>
          <Select
            value={selectedMetric}
            onChange={setSelectedMetric}
            style={{ width: 200 }}
            options={[
              { value: "all", label: "全部指标" },
              ...dimensions.metrics.map((m) => ({ value: m, label: m })),
            ]}
          />
        </Col>
        <Col>
          <Segmented
            value={selectedDimension}
            onChange={(value) => {
              setSelectedDimension(value as string);
              // Reset filters when dimension changes
              if (value !== "platform") {
                setSelectedPlatform("all");
              }
              if (value !== "version") {
                setSelectedVersion("all");
              }
            }}
            options={[
              { label: "全部", value: "all" },
              { label: "按平台", value: "platform" },
              { label: "按版本", value: "version" },
            ]}
          />
        </Col>
        {selectedDimension === "platform" && (
          <Col>
            <Select
              value={selectedPlatform}
              onChange={setSelectedPlatform}
              style={{ width: 150 }}
              options={[
                { value: "all", label: "全部平台" },
                ...dimensions.platforms.map((p) => ({ value: p.value, label: p.label })),
              ]}
            />
          </Col>
        )}
        {selectedDimension === "version" && (
          <Col>
            <Select
              value={selectedVersion}
              onChange={setSelectedVersion}
              style={{ width: 150 }}
              options={[
                { value: "all", label: "全部版本" },
                ...dimensions.versions.map((v) => ({ value: v, label: v })),
              ]}
            />
          </Col>
        )}
      </Row>

      {loading ? (
        <div style={{ textAlign: "center", padding: 100 }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          {/* Dimension Statistics */}
          {(selectedDimension === "platform" || selectedDimension === "version") && aggregatedByDimension.length > 0 && (
            <Card
              title={
                <span>
                  {selectedDimension === "platform" ? "平台统计" : "版本统计"}
                  <Tooltip title="按维度聚合的性能统计汇总">
                    <InfoCircleOutlined style={{ marginLeft: 8, color: "#999" }} />
                  </Tooltip>
                </span>
              }
              style={{ marginBottom: 16 }}
            >
              <Table
                dataSource={aggregatedByDimension}
                columns={summaryColumns}
                rowKey={(record: any) => `${record.metric}-${record.platform}-${record.arch}-${record.version}`}
                pagination={false}
                size="small"
              />
            </Card>
          )}

          {/* Summary stats by dimension */}
          {latestDataByGroup.length > 0 && (
            <Card
              title={
                <span>
                  性能概览 (P50/P90/P95 分布)
                  <Tooltip title="展示各维度最新数据的百分位分布">
                    <InfoCircleOutlined style={{ marginLeft: 8, color: "#999" }} />
                  </Tooltip>
                </span>
              }
              style={{ marginBottom: 16 }}
            >
              {latestDataByGroup.map((item) => (
                <Card
                  key={`${item.metric}-${item.platform}-${item.arch}-${item.version}`}
                  size="small"
                  style={{ marginBottom: 16 }}
                >
                  <Row gutter={24}>
                    <Col span={4}>
                      <div style={{ marginBottom: 8 }}>
                        <Tag color="blue" style={{ fontSize: 14 }}>{item.metric}</Tag>
                        {selectedDimension === "platform" && item.platform && (
                          <Tag color={platformColorMap[item.platform] || "default"} style={{ marginLeft: 4 }}>
                            {getPlatformLabel(item.platform, item.arch)}
                          </Tag>
                        )}
                        {selectedDimension === "version" && item.version && (
                          <Tag style={{ marginLeft: 4 }}>{item.version}</Tag>
                        )}
                      </div>
                    </Col>
                    <Col span={4}>
                      <Statistic
                        title={<span style={{ color: "#52c41a" }}>P50</span>}
                        value={item.p50}
                        suffix="ms"
                        valueStyle={{ fontSize: 20, color: "#52c41a" }}
                      />
                    </Col>
                    <Col span={4}>
                      <Statistic
                        title={<span style={{ color: "#1890ff" }}>P90</span>}
                        value={item.p90}
                        suffix="ms"
                        valueStyle={{ fontSize: 20, color: "#1890ff" }}
                      />
                    </Col>
                    <Col span={4}>
                      <Statistic
                        title={<span style={{ color: "#722ed1" }}>P95</span>}
                        value={item.p95}
                        suffix="ms"
                        valueStyle={{ fontSize: 20, color: "#722ed1" }}
                      />
                    </Col>
                    <Col span={4}>
                      <Statistic
                        title="平均"
                        value={item.avg_value}
                        suffix="ms"
                        valueStyle={{ fontSize: 20 }}
                      />
                    </Col>
                    <Col span={4}>
                      <Statistic
                        title="样本数"
                        value={item.count}
                        valueStyle={{ fontSize: 20 }}
                      />
                    </Col>
                  </Row>
                </Card>
              ))}
            </Card>
          )}

          <Card title="性能趋势数据">
            <Table
              dataSource={data}
              columns={columns}
              rowKey={(record) => `${record.date}-${record.metric}-${record.platform}-${record.arch}-${record.version}`}
              pagination={{ pageSize: 20 }}
              size="small"
            />
          </Card>
        </>
      )}
    </div>
  );
}
