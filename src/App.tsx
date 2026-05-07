import { useEffect, useState } from "react"
import LoginPage from "./components/LoginPage"
import ChatPage from "./components/ChatPage"
import { isLoggedIn } from "./api/client"

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn)

  useEffect(() => {
    document.documentElement.classList.toggle(
      "dark",
      localStorage.getItem("webchat_theme") === "dark",
    )
  }, [])

  const handleAuthChange = () => {
    setLoggedIn(isLoggedIn())
  }

  if (!loggedIn) {
    return <LoginPage onLoginSuccess={handleAuthChange} />
  }

  return <ChatPage />
}
