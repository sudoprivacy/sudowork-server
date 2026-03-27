import React from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Layout as AntLayout, Menu, Avatar, Dropdown } from "antd";
import {
  DashboardOutlined,
  AppstoreOutlined,
  UserOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import "./Layout.css";

const { Sider, Content, Header } = AntLayout;

const Layout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const user = JSON.parse(localStorage.getItem("admin_user") || "{}");

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    navigate("/login");
  };

  const menuItems = [
    { key: "/", icon: <DashboardOutlined />, label: "仪表盘" },
    { key: "/enterprises", icon: <AppstoreOutlined />, label: "企业列表" },
    { key: "/users", icon: <UserOutlined />, label: "用户管理" },
    { key: "/invitation-codes", icon: <AppstoreOutlined />, label: "邀请码管理" },
    { key: "/operation-logs", icon: <AppstoreOutlined />, label: "操作日志" },
  ];

  const userMenuItems = [
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "退出登录",
    },
  ];

  return (
    <AntLayout className="admin-layout" style={{ minHeight: "100vh" }}>
      <Sider className="admin-sider" width={220} theme="dark">
        <div className="admin-logo">
          <span className="admin-logo-text">SUDOWORK</span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          onClick={({ key }) => navigate(key)}
          items={menuItems.map((item) => ({
            key: item.key,
            icon: item.icon,
            label: item.label,
          }))}
        />
      </Sider>

      <AntLayout>
        <Header
          className="admin-header"
          style={{
            padding: "0 24px",
            background: "#fff",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          <Dropdown
            menu={{
              items: userMenuItems,
              onClick: ({ key }) => {
                if (key === "logout") handleLogout();
              },
            }}
            placement="bottomRight"
          >
            <div className="admin-user" style={{ cursor: "pointer" }}>
              <Avatar style={{ backgroundColor: "#1890ff", marginRight: 8 }}>
                {user.nickname?.[0]?.toUpperCase() || "A"}
              </Avatar>
              <span className="admin-user-name">
                {user.nickname || "管理员"}
              </span>
            </div>
          </Dropdown>
        </Header>

        <Content className="admin-content" style={{ margin: 24 }}>
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  );
};

export default Layout;