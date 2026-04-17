import React from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
  Outlet,
} from "react-router-dom";
import { Layout, Menu, Avatar, Dropdown, Breadcrumb, message } from "antd";
import {
  DashboardOutlined,
  AppstoreOutlined,
  UserOutlined,
  LogoutOutlined,
  GiftOutlined,
  FileTextOutlined,
  PayCircleOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import EnterpriseList from "./pages/EnterpriseList";
import UserList from "./pages/UserList";
import InvitationCodeList from "./pages/InvitationCodeList";
import OperationLogs from "./pages/OperationLogs";
import RechargeList from "./pages/RechargeList";
import RechargeRecords from "./pages/RechargeRecords";
import ConfigItemList from "./pages/ConfigItemList";
import "antd/dist/reset.css";
import "./components/Layout.css";

const { Sider, Content, Header } = Layout;

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const token = localStorage.getItem("admin_token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

const MainLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const userStr = localStorage.getItem("admin_user");
  let user: any = {};
  try {
    const parsed = userStr ? JSON.parse(userStr) : null;
    user = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    user = {};
  }

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    message.success("已退出登录");
    navigate("/login");
  };

  const menuItems = [
    { key: "/", icon: <DashboardOutlined />, label: "仪表盘" },
    {
      key: "enterprise-mgmt",
      icon: <AppstoreOutlined />,
      label: "企业管理",
      children: [
        { key: "/enterprises", label: "企业列表" },
        { key: "/config-items", label: "配置项列表" },
      ],
    },
    { key: "/users", icon: <UserOutlined />, label: "用户管理" },
    { key: "/orders", icon: <UnorderedListOutlined />, label: "订单管理" },
    { key: "/recharge-records", icon: <PayCircleOutlined />, label: "充值记录" },
    { key: "/invitation-codes", icon: <GiftOutlined />, label: "邀请码管理" },
    { key: "/logs", icon: <FileTextOutlined />, label: "操作日志" },
  ];

  const userMenuItems = [
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "退出登录",
    },
  ];

  return (
    <Layout className="admin-layout">
      <Sider className="admin-sider" width={256}>
        <div className="admin-logo">
          <span className="admin-logo-text">SUDOWORK</span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={["enterprise-mgmt"]}
          onClick={({ key }) => navigate(key)}
          items={menuItems}
        />
      </Sider>

      <Layout>
        <Header className="admin-header">
          <Breadcrumb className="admin-breadcrumb">
            <Breadcrumb.Item>首页</Breadcrumb.Item>
            {location.pathname !== "/" && (() => {
              for (const item of menuItems) {
                if ('children' in item && item.children) {
                  for (const child of item.children) {
                    if (child.key === location.pathname) {
                      return (
                        <React.Fragment key={item.key}>
                          <Breadcrumb.Item>{item.label}</Breadcrumb.Item>
                          <Breadcrumb.Item>{child.label}</Breadcrumb.Item>
                        </React.Fragment>
                      );
                    }
                  }
                } else if (item.key === location.pathname) {
                  return <Breadcrumb.Item key={item.key}>{item.label}</Breadcrumb.Item>;
                }
              }
              return <Breadcrumb.Item>页面</Breadcrumb.Item>;
            })()}
          </Breadcrumb>

          <Dropdown menu={{ items: userMenuItems, onClick: ({ key }) => key === "logout" && handleLogout() }} placement="bottomRight">
            <div className="admin-user">
              <Avatar style={{ backgroundColor: "#165DFF" }}>
                {user.nickname?.[0]?.toUpperCase() || "A"}
              </Avatar>
              <span className="admin-user-name">{user.nickname || "管理员"}</span>
            </div>
          </Dropdown>
        </Header>

        <Content className="admin-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="enterprises" element={<EnterpriseList />} />
          <Route path="config-items" element={<ConfigItemList />} />
          <Route path="users" element={<UserList />} />
          <Route path="orders" element={<RechargeList />} />
          <Route path="recharge-records" element={<RechargeRecords />} />
          <Route path="invitation-codes" element={<InvitationCodeList />} />
          <Route path="logs" element={<OperationLogs />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;