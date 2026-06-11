/**
 * Crash Statistics page
 */

import React, { useState, useEffect } from "react";
import { Card, Row, Col, Statistic, Spin, Select, Empty } from "antd";
import { WarningOutlined, CheckCircleOutlined, ClockCircleOutlined, BugOutlined } from "@ant-design/icons";
import { Column } from "@ant-design/plots";
import { Pie } from "@ant-design/plots";
import { api } from "../../api/qms/client";
import { useQmsTenantFilter } from "../../hooks/qms";
import type { CrashStatsSummary, CrashTrendItem, CrashDistributionItem } from "../../api/qms/types";

export default function CrashStats() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<CrashStatsSummary | null>(null);
  const [trend, setTrend] = useState<CrashTrendItem[]>([]);
  const [distribution, setDistribution] = useState<CrashDistributionItem[]>([]);
  const [distributionBy, setDistributionBy] = useState<"version" | "platform" | "type">("type");
  const [trendDays, setTrendDays] = useState(7);
  const tenantFilter = useQmsTenantFilter();

  useEffect(() => {
    fetchData();
  }, [distributionBy, trendDays, tenantFilter]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsResult, trendResult, distResult] = await Promise.all([
        api.getCrashStatsSummary(),
        api.getCrashTrend(trendDays),
        api.getCrashDistribution(distributionBy),
      ]);
      setStats(statsResult);
      setTrend(trendResult);
      setDistribution(distResult);
    } catch (err) {
      console.error("Failed to fetch crash stats:", err);
    } finally {
      setLoading(false);
    }
  };

  const trendConfig = {
    data: trend,
    xField: "date",
    yField: "count",
    seriesField: "type",
    isGroup: true,
    columnStyle: {
      radius: [4, 4, 0, 0],
    },
    legend: {
      position: "top" as const,
    },
    color: ({ type }: { type: string }) => {
      if (type === "native_crash" || type === "renderer_crash") return "#ff4d4f";
      return "#faad14";
    },
  };

  const pieConfig = {
    data: distribution,
    angleField: "count",
    colorField: "key",
    radius: 0.8,
    innerRadius: 0.6,
    label: {
      type: "inner" as const,
      offset: "-50%" as const,
      content: "{value}",
      style: {
        textAlign: "center" as const,
        fontSize: 14,
      },
    },
    statistic: {
      title: {
        content: "总计",
        style: { fontSize: 14 },
      },
      content: {
        style: { fontSize: 20 },
        formatter: () => {
          const total = distribution.reduce((sum, item) => sum + item.count, 0);
          return total.toString();
        },
      },
    },
    legend: {
      position: "right" as const,
    },
    interactions: [{ type: "element-selected" }, { type: "element-active" }],
  };

  return (
    <div>
      <Card title="Crash 统计概览" extra={<Select
        defaultValue={7}
        style={{ width: 100 }}
        onChange={(value) => setTrendDays(value)}
        options={[
          { value: 7, label: "近7天" },
          { value: 14, label: "近14天" },
          { value: 30, label: "近30天" },
        ]}
      />}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 50 }}>
            <Spin size="large" />
          </div>
        ) : stats ? (
          <Row gutter={[16, 16]}>
            <Col span={4}>
              <Card>
                <Statistic
                  title="总事件数"
                  value={stats.total_events}
                  prefix={<BugOutlined />}
                  valueStyle={{ color: "#1890ff" }}
                />
              </Card>
            </Col>
            <Col span={4}>
              <Card>
                <Statistic
                  title="未解决 Issue"
                  value={stats.unresolved_issues}
                  prefix={<WarningOutlined />}
                  valueStyle={{ color: "#ff4d4f" }}
                />
              </Card>
            </Col>
            <Col span={4}>
              <Card>
                <Statistic
                  title="致命 Issue"
                  value={stats.fatal_issues}
                  prefix={<WarningOutlined />}
                  valueStyle={{ color: "#ff4d4f" }}
                />
              </Card>
            </Col>
            <Col span={4}>
              <Card>
                <Statistic
                  title="普通错误 Issue"
                  value={stats.error_issues}
                  prefix={<WarningOutlined />}
                  valueStyle={{ color: "#faad14" }}
                />
              </Card>
            </Col>
            <Col span={4}>
              <Card>
                <Statistic
                  title="近24小时"
                  value={stats.recent_24h}
                  prefix={<ClockCircleOutlined />}
                  valueStyle={{ color: stats.recent_24h > 10 ? "#ff4d4f" : "#52c41a" }}
                />
              </Card>
            </Col>
            <Col span={4}>
              <Card>
                <Statistic
                  title="近7天"
                  value={stats.recent_7d}
                  prefix={<ClockCircleOutlined />}
                  valueStyle={{ color: stats.recent_7d > 50 ? "#ff4d4f" : "#52c41a" }}
                />
              </Card>
            </Col>
          </Row>
        ) : (
          <Empty />
        )}
      </Card>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={16}>
          <Card title="Crash 趋势">
            {loading ? (
              <div style={{ textAlign: "center", padding: 50 }}>
                <Spin />
              </div>
            ) : trend.length > 0 ? (
              <Column {...trendConfig} height={300} />
            ) : (
              <Empty description="暂无趋势数据" />
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card
            title="Crash 分布"
            extra={
              <Select
                value={distributionBy}
                style={{ width: 100 }}
                onChange={(value) => setDistributionBy(value)}
                options={[
                  { value: "type", label: "按类型" },
                  { value: "platform", label: "按平台" },
                  { value: "version", label: "按版本" },
                ]}
              />
            }
          >
            {loading ? (
              <div style={{ textAlign: "center", padding: 50 }}>
                <Spin />
              </div>
            ) : distribution.length > 0 ? (
              <Pie {...pieConfig} height={300} />
            ) : (
              <Empty description="暂无分布数据" />
            )}
          </Card>
        </Col>
      </Row>

      <Card title="分布详情" style={{ marginTop: 16 }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 50 }}>
            <Spin />
          </div>
        ) : distribution.length > 0 ? (
          <Row gutter={[16, 16]}>
            {distribution.map((item) => (
              <Col span={4} key={item.key}>
                <Card size="small">
                  <Statistic
                    title={item.key}
                    value={item.count}
                    suffix={`(${item.percentage}%)`}
                  />
                </Card>
              </Col>
            ))}
          </Row>
        ) : (
          <Empty description="暂无数据" />
        )}
      </Card>
    </div>
  );
}
