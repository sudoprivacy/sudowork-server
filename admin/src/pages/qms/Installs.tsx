/**
 * Install statistics page
 */

import React, { useState, useEffect } from "react";
import { Card, Table, Tag, Spin, Row, Col, Select, Progress, Statistic, Segmented, Tooltip } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { api } from "../../api/qms/client";
import { StatCard, TimeRangeFilter } from "../../components/qms";
import { useCachedTimeRange, useQmsTenantFilter } from "../../hooks/qms";

interface InstallDailyData {
  date: string;
  platform?: string;
  arch?: string;
  version: string;
  install_type: string;
  success_count: number;
  failed_count: number;
  total_count: number;
  success_rate: number;
}

interface InstallDimensions {
  platforms: { platform: string; arch: string; label: string; value: string }[];
  versions: string[];
  install_types: string[];
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

export default function Installs() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InstallDailyData[]>([]);
  const [dimensions, setDimensions] = useState<InstallDimensions>({ platforms: [], versions: [], install_types: [] });
  const { timeRange, activePreset, setTimeRange, applyPreset } = useCachedTimeRange("installs");
  const tenantFilter = useQmsTenantFilter();
  const [selectedInstallType, setSelectedInstallType] = useState<string>("all");
  const [selectedDimension, setSelectedDimension] = useState<string>("all");

  useEffect(() => {
    fetchDimensions();
  }, [timeRange, tenantFilter]);

  useEffect(() => {
    fetchData();
  }, [timeRange, selectedDimension, tenantFilter]);

  const fetchDimensions = async () => {
    try {
      const result = await api.getInstallDimensions(timeRange[0], timeRange[1]);
      setDimensions(result);
    } catch (err) {
      console.error("Failed to fetch dimensions:", err);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const result = await api.getInstallTrend(timeRange[0], timeRange[1], selectedDimension);
      setData(result as InstallDailyData[]);
    } catch (err) {
      console.error("Failed to fetch install data:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredData = selectedInstallType === "all"
    ? data
    : data.filter((d) => d.install_type === selectedInstallType);

  // Calculate summary
  const totalInstalls = filteredData.reduce((sum, d) => sum + d.total_count, 0);
  const totalSuccess = filteredData.reduce((sum, d) => sum + d.success_count, 0);
  const totalFailed = filteredData.reduce((sum, d) => sum + d.failed_count, 0);
  const overallSuccessRate = totalInstalls > 0
    ? Math.round((totalSuccess / totalInstalls) * 100)
    : 0;

  // Group by version
  const versionSummary = filteredData.reduce((acc, d) => {
    const version = d.version || "unknown";
    if (!acc[version]) {
      acc[version] = { success: 0, failed: 0, total: 0 };
    }
    acc[version].success += d.success_count;
    acc[version].failed += d.failed_count;
    acc[version].total += d.total_count;
    return acc;
  }, {} as Record<string, { success: number; failed: number; total: number }>);

  const versions = Object.entries(versionSummary)
    .map(([version, stats]) => ({
      version,
      ...stats,
      success_rate: Math.round((stats.success / stats.total) * 100),
    }))
    .sort((a, b) => b.total - a.total);

  // Group by platform
  const platformSummary = filteredData.reduce((acc, d) => {
    if (!d.platform) return acc;
    const key = `${d.platform}|${d.arch}`;
    if (!acc[key]) {
      acc[key] = { platform: d.platform, arch: d.arch || "unknown", success: 0, failed: 0, total: 0 };
    }
    acc[key].success += d.success_count;
    acc[key].failed += d.failed_count;
    acc[key].total += d.total_count;
    return acc;
  }, {} as Record<string, { platform: string; arch: string; success: number; failed: number; total: number }>);

  const platforms = Object.entries(platformSummary)
    .map(([key, stats]) => ({
      key,
      ...stats,
      success_rate: Math.round((stats.success / stats.total) * 100),
    }))
    .sort((a, b) => b.total - a.total);

  // Group all data by dimension for aggregated stats
  const aggregatedByDimension = React.useMemo(() => {
    const groupMap = new Map<string, {
      platform?: string;
      arch?: string;
      version?: string;
      success: number;
      failed: number;
      total: number;
    }>();

    for (const row of filteredData) {
      const key = selectedDimension === "platform"
        ? `${row.platform}|${row.arch}`
        : selectedDimension === "version"
        ? row.version
        : "all";

      const existing = groupMap.get(key);
      if (existing) {
        existing.success += row.success_count;
        existing.failed += row.failed_count;
        existing.total += row.total_count;
      } else {
        groupMap.set(key, {
          platform: row.platform,
          arch: row.arch,
          version: row.version,
          success: row.success_count,
          failed: row.failed_count,
          total: row.total_count,
        });
      }
    }

    return Array.from(groupMap.values()).map(item => ({
      ...item,
      successRate: item.total > 0 ? Math.round((item.success / item.total) * 100) : 0,
    }));
  }, [filteredData, selectedDimension]);

  const columns = [
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
        render: (_: unknown, record: InstallDailyData) => (
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
        render: (v: string) => <Tag color="blue">{v}</Tag>,
      },
    ] : []),
    {
      title: "类型",
      dataIndex: "install_type",
      key: "install_type",
      render: (type: string) => (
        <Tag color={type === "fresh" ? "green" : "orange"}>
          {type === "fresh" ? "首次安装" : "更新"}
        </Tag>
      ),
    },
    {
      title: "成功",
      dataIndex: "success_count",
      key: "success_count",
      render: (v: number) => <Tag color="green">{v}</Tag>,
      sorter: true,
    },
    {
      title: "失败",
      dataIndex: "failed_count",
      key: "failed_count",
      render: (v: number) => <Tag color="red">{v}</Tag>,
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
  ];

  const versionColumns = [
    {
      title: "版本",
      dataIndex: "version",
      key: "version",
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: "成功",
      dataIndex: "success",
      key: "success",
      sorter: true,
    },
    {
      title: "失败",
      dataIndex: "failed",
      key: "failed",
      sorter: true,
    },
    {
      title: "总数",
      dataIndex: "total",
      key: "total",
      sorter: true,
    },
    {
      title: "成功率",
      dataIndex: "success_rate",
      key: "success_rate",
      render: (rate: number) => `${rate}%`,
      sorter: true,
    },
  ];

  const platformColumns = [
    {
      title: "平台",
      key: "platform_display",
      render: (_: unknown, record: { platform: string; arch: string }) => (
        <Tag color={platformColorMap[record.platform] || "default"}>
          {getPlatformLabel(record.platform, record.arch)}
        </Tag>
      ),
    },
    {
      title: "成功",
      dataIndex: "success",
      key: "success",
      sorter: true,
    },
    {
      title: "失败",
      dataIndex: "failed",
      key: "failed",
      sorter: true,
    },
    {
      title: "总数",
      dataIndex: "total",
      key: "total",
      sorter: true,
    },
    {
      title: "成功率",
      dataIndex: "success_rate",
      key: "success_rate",
      render: (rate: number) => `${rate}%`,
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
        <Col>
          <Select
            value={selectedInstallType}
            onChange={setSelectedInstallType}
            style={{ width: 150 }}
            options={[
              { value: "all", label: "全部类型" },
              { value: "fresh", label: "首次安装" },
              { value: "update", label: "更新" },
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
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={4}>
              <StatCard title="总安装" value={totalInstalls} color="normal" />
            </Col>
            <Col span={4}>
              <StatCard title="成功" value={totalSuccess} color="success" />
            </Col>
            <Col span={4}>
              <StatCard title="失败" value={totalFailed} color="error" />
            </Col>
            <Col span={4}>
              <StatCard title="成功率" value={overallSuccessRate} suffix="%" color="success" />
            </Col>
          </Row>

          {/* Dimension Statistics */}
          {(selectedDimension === "platform" || selectedDimension === "version") && aggregatedByDimension.length > 0 && (
            <Card
              title={
                <span>
                  {selectedDimension === "platform" ? "平台统计" : "版本统计"}
                  <Tooltip title="按维度聚合的安装统计">
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
                    <Col span={4}>
                      <Statistic title="成功" value={item.success} valueStyle={{ fontSize: 18, color: "#52c41a" }} />
                    </Col>
                    <Col span={4}>
                      <Statistic title="失败" value={item.failed} valueStyle={{ fontSize: 18, color: "#ff4d4f" }} />
                    </Col>
                    <Col span={4}>
                      <Statistic title="总数" value={item.total} valueStyle={{ fontSize: 18 }} />
                    </Col>
                    <Col span={4}>
                      <Statistic title="成功率" value={item.successRate} suffix="%" valueStyle={{ fontSize: 18, color: item.successRate >= 95 ? "#52c41a" : item.successRate >= 80 ? "#1890ff" : "#ff4d4f" }} />
                    </Col>
                  </Row>
                </Card>
              ))}
            </Card>
          )}

          {/* All dimension view - show both version and platform tables */}
          {selectedDimension === "all" && (
            <Row gutter={16}>
              <Col span={12}>
                <Card title="版本统计" style={{ marginBottom: 16 }}>
                  <Table
                    dataSource={versions}
                    columns={versionColumns}
                    rowKey="version"
                    pagination={false}
                    size="small"
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card title="平台统计" style={{ marginBottom: 16 }}>
                  <Table
                    dataSource={platforms}
                    columns={platformColumns}
                    rowKey="key"
                    pagination={false}
                    size="small"
                  />
                </Card>
              </Col>
            </Row>
          )}

          <Card title="安装趋势">
            <Table
              dataSource={filteredData}
              columns={columns}
              rowKey={(record) => `${record.date}-${record.platform}-${record.arch}-${record.version}-${record.install_type}`}
              pagination={{ pageSize: 20 }}
              size="small"
            />
          </Card>
        </>
      )}
    </div>
  );
}
