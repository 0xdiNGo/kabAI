import { BrowserRouter, Routes, Route } from "react-router-dom";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import ChatPage from "@/pages/ChatPage";
import ProvidersPage from "@/pages/ProvidersPage";
import AgentsPage from "@/pages/AgentsPage";
import KnowledgeBasePage from "@/pages/KnowledgeBasePage";
import ExemplarSetPage from "@/pages/ExemplarSetPage";
import SearchProvidersPage from "@/pages/SearchProvidersPage";
import ChatsPage from "@/pages/ChatsPage";
import ConnectorsPage from "@/pages/ConnectorsPage";
import ConnectorDetailPage from "@/pages/ConnectorDetailPage";
import UsagePage from "@/pages/UsagePage";
import AppLayout from "@/components/layout/AppLayout";
import CommandPalette from "@/components/CommandPalette";

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <CommandPalette />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/agents/manage" element={<AgentsPage />} />
          <Route path="/knowledge-bases" element={<KnowledgeBasePage />} />
          <Route path="/exemplar-sets" element={<ExemplarSetPage />} />
          <Route path="/search-providers" element={<SearchProvidersPage />} />
          <Route path="/chats" element={<ChatsPage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/connectors" element={<ConnectorsPage />} />
          <Route path="/connectors/:connectorId" element={<ConnectorDetailPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/chat/:conversationId" element={<ChatPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
