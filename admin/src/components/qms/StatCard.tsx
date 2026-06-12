/**
 * Stat card component for displaying metrics
 */

import React from "react";
import { Card, Statistic, Tooltip } from "antd";
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  InfoCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";

interface StatCardProps {
  title: string;
  value: number;
  suffix?: string;
  prefix?: React.ReactNode;
  trend?: number;
  tooltip?: string;
  loading?: boolean;
  color?: "success" | "error" | "warning" | "normal";
  /**
   * Data freshness indicator
   * - "realtime": Data is from raw table, shows current state
   * - "aggregated": Data is from daily aggregated table, may have delay
   */
  freshness?: "realtime" | "aggregated";
}

const colorMap = {
  success: "#52c41a",
  error: "#f5222d",
  warning: "#faad14",
  normal: "#1890ff",
};

const freshnessConfig = {
  realtime: {
    icon: <ThunderboltOutlined />,
    tooltip: "实时数据：来自原始数据表，反映当前状态",
    color: "#52c41a",
  },
  aggregated: {
    icon: <ClockCircleOutlined />,
    tooltip: "聚合数据：来自每日聚合表，可能存在1小时延迟",
    color: "#faad14",
  },
};

export default function StatCard({
  title,
  value,
  suffix,
  prefix,
  trend,
  tooltip,
  loading,
  color = "normal",
  freshness,
}: StatCardProps) {
  const trendValue = trend ?? 0;
  const trendColor = trendValue > 0 ? "#52c41a" : trendValue < 0 ? "#f5222d" : "#666";
  const trendIcon = trendValue > 0 ? <ArrowUpOutlined /> : trendValue < 0 ? <ArrowDownOutlined /> : null;

  const titleNode = (
    <span style={{ color: colorMap[color] }}>
      {title}
      {tooltip && (
        <Tooltip title={tooltip}>
          <InfoCircleOutlined style={{ marginLeft: 8, color: "#999" }} />
        </Tooltip>
      )}
      {freshness && (
        <Tooltip title={freshnessConfig[freshness].tooltip}>
          <span style={{ marginLeft: 8 }}>{freshnessConfig[freshness].icon}</span>
        </Tooltip>
      )}
    </span>
  );

  return (
    <Card loading={loading}>
      <Statistic
        title={titleNode}
        value={value}
        suffix={suffix}
        prefix={prefix}
        valueStyle={{ color: colorMap[color] }}
      />
      {trend !== undefined && (
        <div style={{ marginTop: 8, color: trendColor }}>
          {trendIcon}
          <span style={{ marginLeft: 4 }}>
            {trendValue > 0 ? "+" : ""}{trendValue}% 相比上期
          </span>
        </div>
      )}
    </Card>
  );
}
