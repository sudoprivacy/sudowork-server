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
} from "@ant-design/icons";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import EnterpriseList from "./pages/EnterpriseList";
import UserList from "./pages/UserList";
import InvitationCodeList from "./pages/InvitationCodeList";
import OperationLogs from "./pages/OperationLogs";
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
  const user = JSON.parse(localStorage.getItem("admin_user") || "{}");

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    message.success("已退出登录");
    navigate("/login");
  };

  const menuItems = [
    { key: "/", icon: <DashboardOutlined />, label: "仪表盘" },
    { key: "/enterprises", icon: <AppstoreOutlined />, label: "企业管理" },
    { key: "/users", icon: <UserOutlined />, label: "用户管理" },
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
          onClick={({ key }) => navigate(key)}
          items={menuItems}
        />
      </Sider>

      <Layout>
        <Header className="admin-header">
          <Breadcrumb className="admin-breadcrumb">
            <Breadcrumb.Item>首页</Breadcrumb.Item>
            {location.pathname !== "/" && (
              <Breadcrumb.Item>
                {menuItems.find((item) => item.key === location.pathname)?.label || "页面"}
              </Breadcrumb.Item>
            )}
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
          <Route path="users" element={<UserList />} />
          <Route path="invitation-codes" element={<InvitationCodeList />} />
          <Route path="logs" element={<OperationLogs />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;