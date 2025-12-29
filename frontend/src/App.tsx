import { Route, Routes } from "react-router-dom"

import AppLayout from "@/layouts/AppLayout"
import Overview from "@/pages/Overview"
import Providers from "@/pages/Providers"
import Logs from "@/pages/Logs"
import Settings from "@/pages/Settings"

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Overview />} />
        <Route path="/providers" element={<Providers />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}

export default App
