import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import React from "react";
import { ThemeProvider } from "./lib/theme";
import Layout from "./pages/_layout";
import HomePage from "./pages/index";
import HostsPage from "./pages/hosts";
import VMsPage from "./pages/vms";
import VMDetailPage from "./pages/vm-detail";
import DatastoresPage from "./pages/datastores";
import NetworksPage from "./pages/networks";
import SnapshotsPage from "./pages/snapshots";
import CMDBPage from "./pages/cmdb";
import SettingsPage from "./pages/settings";
import NotFoundPage from "./pages/not-found";
import VCenterHealthPage from "./pages/vcenter-health";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: "" };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center p-8">
            <h1 className="text-xl font-bold text-destructive mb-2">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">{this.state.error}</p>
            <button
              className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded"
              onClick={() => this.setState({ hasError: false, error: "" })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <Router>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="/vms" element={<VMsPage />} />
              <Route path="/vm/:vmName" element={<VMDetailPage />} />
              <Route path="/hosts" element={<HostsPage />} />
              <Route path="/datastores" element={<DatastoresPage />} />
              <Route path="/networks" element={<NetworksPage />} />
              <Route path="/snapshots" element={<SnapshotsPage />} />
              <Route path="/cmdb" element={<CMDBPage />} />
              <Route path="/vcenter-health" element={<VCenterHealthPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Router>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
