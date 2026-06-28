/**
 * Dashboard overview page
 */

import React, { useState, useEffect } from "react";
import { Row, Col, Card, Table, Tag, Spin } from "antd";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/qms/client";
import { StatCard, TimeRangeFilter } from "../../components/qms";
import { useCachedTimeRange, useQmsTenantFilter } from "../../hooks/qms";
import type { DashboardOverview } from "../../api/qms/types";

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardOverview | null>(null);
  const { timeRange, activePreset, setTimeRange, applyPreset } = useCachedTimeRange("dashboard");
  const tenantFilter = useQmsTenantFilter();
  const navigate = useNavigate();

  useEffect(() => {
    fetchData();
  }, [timeRange, tenantFilter]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const result = await api.getDashboardOverview(timeRange[0], timeRange[1]);
      setData(result);
    } catch (err) {
      console.error("Failed to fetch dashboard:", err);
    } finally {
      setLoading(false);
    }
  };

  const navigateToConversations = () => {
    const params = new URLSearchParams({
      start_time: timeRange[0].toString(),
      end_time: timeRange[1].toString(),
    });
    navigate(`/qms/conversations?${params.toString()}`);
  };

  // Columns definitions - must be before conditional returns
  const installColumns = [
    {
      title: "版本",
      dataIndex: "version",
      key: "version",
    },
    {
      title: "次数",
      dataIndex: "count",
      key: "count",
      sorter: true,
    },
  ];

  const platformColumns = [
    {
      title: "平台",
      dataIndex: "platform",
      key: "platform",
      render: (platform: string) => {
        const colorMap: Record<string, string> = {
          darwin: "blue",
          win32: "green",
          linux: "orange",
        };
        return <Tag color={colorMap[platform] || "default"}>{platform}</Tag>;
      },
    },
    {
      title: "次数",
      dataIndex: "count",
      key: "count",
    },
  ];

  // Crash columns 已随总览 Crash 统计区块一同移除

  // Conditional returns AFTER all hooks are defined
  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!data) {
    return <div>加载失败</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <TimeRangeFilter
          value={timeRange}
          activePreset={activePreset}
          onChange={setTimeRange}
          onPresetChange={applyPreset}
        />
      </div>

      {/* Conversation Stats */}
      <Card title="对话概览" extra={<a onClick={navigateToConversations}>查看详情</a>}>
        <Row gutter={16}>
          <Col span={6}>
            <StatCard
              title="对话总数"
              value={data.conversations?.total ?? 0}
              trend={data.conversations?.trend ?? 0}
              color="normal"
              freshness="realtime"
            />
          </Col>
          <Col span={6}>
            <StatCard
              title="成功率"
              value={data.conversations?.success_rate ?? 0}
              suffix="%"
              color="success"
              freshness="realtime"
            />
          </Col>
          <Col span={6}>
            <StatCard
              title="错误数"
              value={data.conversations?.error ?? 0}
              trend={data.errors?.trend ?? 0}
              color="error"
              freshness="realtime"
            />
          </Col>
          <Col span={6}>
            <StatCard
              title="平均时长"
              value={data.conversations?.avg_duration_ms ?? 0}
              suffix="ms"
              tooltip="对话平均响应时长"
              color="normal"
              freshness="realtime"
            />
          </Col>
        </Row>
      </Card>

      {/* Performance Stats */}
      <Card title="性能指标" style={{ marginTop: 16 }} extra={<a onClick={() => navigate("/qms/performance")}>查看详情</a>}>
        {(data.performance?.metrics || []).map((metric) => (
          <div key={metric.metric} style={{ marginBottom: 16 }}>
            <h4 style={{ marginBottom: 8, color: "#1890ff" }}>{metric.metric}</h4>
            <Row gutter={16}>
              <Col span={6}>
                <StatCard
                  title="平均值"
                  value={metric.avg}
                  suffix="ms"
                  trend={metric.trend}
                  freshness="realtime"
                />
              </Col>
              <Col span={6}>
                <StatCard
                  title="P50"
                  value={metric.p50}
                  suffix="ms"
                  color="normal"
                  freshness="realtime"
                />
              </Col>
              <Col span={6}>
                <StatCard
                  title="P90"
                  value={metric.p90}
                  suffix="ms"
                  color="warning"
                  freshness="realtime"
                />
              </Col>
              <Col span={6}>
                <StatCard
                  title="P95"
                  value={metric.p95}
                  suffix="ms"
                  color="error"
                  freshness="realtime"
                />
              </Col>
            </Row>
          </div>
        ))}
      </Card>

      {/* Install Stats */}
      <Card title="安装统计" style={{ marginTop: 16 }} extra={<a onClick={() => navigate("/qms/installs")}>查看详情</a>}>
        <Row gutter={16}>
          <Col span={4}>
            <StatCard
              title="总安装"
              value={data.installs?.total ?? 0}
              color="normal"
              freshness="realtime"
            />
          </Col>
          <Col span={4}>
            <StatCard
              title="成功"
              value={data.installs?.success ?? 0}
              color="success"
              freshness="realtime"
            />
          </Col>
          <Col span={4}>
            <StatCard
              title="失败"
              value={data.installs?.failed ?? 0}
              color="error"
              freshness="realtime"
            />
          </Col>
          <Col span={4}>
            <StatCard
              title="成功率"
              value={data.installs?.success_rate ?? 0}
              suffix="%"
              color="success"
              freshness="realtime"
            />
          </Col>
        </Row>

        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col span={12}>
            <h4 style={{ marginBottom: 8 }}>按版本</h4>
            <Table
              dataSource={data.installs?.by_version || []}
              columns={installColumns}
              rowKey="version"
              pagination={false}
              size="small"
            />
          </Col>
          <Col span={12}>
            <h4 style={{ marginBottom: 8 }}>按平台</h4>
            <Table
              dataSource={data.installs?.by_platform || []}
              columns={platformColumns}
              rowKey="platform"
              pagination={false}
              size="small"
            />
          </Col>
        </Row>
      </Card>

      {/* Crash Stats — 隐藏：与侧栏 "/qms/crash-stats" 一致暂不对外展示 */}
    </div>
  );
}
