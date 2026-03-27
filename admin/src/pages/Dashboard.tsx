import React, { useState, useEffect } from "react";
import { Card, Row, Col, Typography, Spin } from "antd";
import {
  AppstoreOutlined,
  UserOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import { adminApi } from "../api/index";
import "./Dashboard.css";

const { Title } = Typography;

interface Stats {
  enterprises: number;
  users: number;
  approved: number;
  pending: number;
  points: {
    total: number;
    bonus: number;
    consumed: number;
  };
}

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const response = await adminApi.getStats();
      if (response && (response as any).success) {
        setStats((response as any).data);
      }
    } catch (error) {
      console.error("Failed to load stats:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="dashboard-loading">
        <Spin size="large" />
      </div>
    );
  }

  if (!stats) {
    return <div className="dashboard-loading">加载失败</div>;
  }

  const statCards = [
    {
      icon: <AppstoreOutlined style={{ fontSize: 32 }} />,
      label: "企业总数",
      value: stats.enterprises,
      color: "#165DFF",
    },
    {
      icon: <UserOutlined style={{ fontSize: 32 }} />,
      label: "用户总数",
      value: stats.users,
      color: "#00B42A",
    },
    {
      icon: <CheckCircleOutlined style={{ fontSize: 32 }} />,
      label: "已审批",
      value: stats.approved,
      color: "#14C9C9",
    },
    {
      icon: <ClockCircleOutlined style={{ fontSize: 32 }} />,
      label: "待审批",
      value: stats.pending,
      color: "#FF7D00",
    },
  ];

  return (
    <div className="dashboard">
      <Title level={2} style={{ marginBottom: 24 }}>
        仪表盘
      </Title>

      <Row gutter={24} style={{ marginBottom: 24 }}>
        {statCards.map((item, index) => (
          <Col span={6} key={index}>
            <Card className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: `${item.color}15`, color: item.color }}>
                {item.icon}
              </div>
              <div className="stat-content">
                <div className="stat-label">{item.label}</div>
                <div className="stat-value">{item.value}</div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Card title="积分统计" style={{ marginBottom: 24 }}>
        <Row gutter={24}>
          <Col span={8}>
            <div className="points-stat">
              <div className="points-label">总发放</div>
              <div className="points-value">{stats.points.bonus.toLocaleString()}</div>
            </div>
          </Col>
          <Col span={8}>
            <div className="points-stat">
              <div className="points-label">总消耗</div>
              <div className="points-value">{stats.points.consumed.toLocaleString()}</div>
            </div>
          </Col>
          <Col span={8}>
            <div className="points-stat">
              <div className="points-label">当前余额</div>
              <div className="points-value" style={{ color: "#165DFF" }}>
                {stats.points.total.toLocaleString()}
              </div>
            </div>
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default Dashboard;