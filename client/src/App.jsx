import { useState, useCallback, useRef } from "react";
import { useWebSocket }       from "./hooks/useWebSocket";
import { JoinScreen }         from "./components/JoinScreen";
import { Sidebar }            from "./components/Sidebar";
import { ChatWindow }         from "./components/ChatWindow";
import { MetricsDashboard }   from "./components/MetricsDashboard";
import { genClientId }        from "./utils/helpers";

export default function App() {
  const [phase,         setPhase]         = useState("join");
  const [showMetrics,   setShowMetrics]   = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);

  const [myUsername,  setMyUsername]  = useState(null);
  const [currentRoom, setCurrentRoom] = useState("general");
  const [rooms]                       = useState(["general","engineering","random","design"]);
  const [messages,    setMessages]    = useState([]);
  const [users,       setUsers]       = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [metrics,     setMetrics]     = useState(null);

  const typingTimers = useRef(new Map());

  const handleMessage = useCallback((msg) => {
    switch (msg.type) {

      case "joined": {
        setCurrentRoom(msg.room);
        setUsers(msg.users || []);
        setMessages((msg.history || []).map(m => ({ ...m, deliveryStatus: "delivered" })));
        setTypingUsers([]);
        if (msg.metrics) setMetrics(msg.metrics);
        setPhase("chat");
        break;
      }

      case "room_switched": {
        setCurrentRoom(msg.room);
        setUsers(msg.users || []);
        setMessages((msg.history || []).map(m => ({ ...m, deliveryStatus: "delivered" })));
        setTypingUsers([]);
        break;
      }

      case "message": {
        const incoming = { ...msg.message, deliveryStatus: "delivered" };
        setMessages(prev => {
          if (prev.some(m => m.id === incoming.id || (m.clientMsgId && m.clientMsgId === incoming.clientMsgId))) return prev;
          return [...prev, incoming];
        });
        break;
      }

      case "message_ack": {
        setMessages(prev => prev.map(m =>
          m.clientMsgId === msg.clientMsgId
            ? { ...m, id: msg.serverId, deliveryStatus: msg.delivered > 0 ? "delivered" : "sent" }
            : m
        ));
        break;
      }

      case "user_joined": {
        setUsers(msg.users || []);
        setMessages(prev => [...prev, {
          id: `sys_${Date.now()}`, type: "system",
          content: `${msg.username} joined the room`,
          timestamp: new Date().toISOString(),
        }]);
        break;
      }

      case "user_left": {
        setUsers(msg.users || []);
        setMessages(prev => [...prev, {
          id: `sys_${Date.now()}`, type: "system",
          content: `${msg.username} left the room`,
          timestamp: new Date().toISOString(),
        }]);
        setTypingUsers(prev => prev.filter(u => u.userId !== msg.userId));
        break;
      }

      case "typing": {
        const { userId, username, isTyping } = msg;
        if (typingTimers.current.has(userId)) clearTimeout(typingTimers.current.get(userId));
        if (isTyping) {
          setTypingUsers(prev => prev.find(u => u.userId === userId) ? prev : [...prev, { userId, username }]);
          typingTimers.current.set(userId, setTimeout(() => {
            setTypingUsers(prev => prev.filter(u => u.userId !== userId));
          }, 3000));
        } else {
          setTypingUsers(prev => prev.filter(u => u.userId !== userId));
        }
        break;
      }

      default: break;
    }
  }, []);

  const handleMetrics = useCallback((m) => setMetrics(m), []);

  const { state: connState, socketId, rtt, sendMessage, join, switchRoom, sendTyping } =
    useWebSocket({ onMessage: handleMessage, onMetrics: handleMetrics });

  const handleJoin = useCallback((username, room) => {
    setMyUsername(username);
    join(username, room);
  }, [join]);

  const handleSend = useCallback((content) => {
    const clientMsgId = genClientId();
    setMessages(prev => [...prev, {
      clientMsgId,
      isMine        : true,
      userId        : socketId,
      username      : myUsername,
      content,
      room          : currentRoom,
      timestamp     : new Date().toISOString(),
      deliveryStatus: "sending",
    }]);
    sendMessage(content, clientMsgId);
  }, [socketId, myUsername, currentRoom, sendMessage]);

  const handleRoomSwitch = useCallback((room) => {
    if (room === currentRoom) return;
    switchRoom(room);
  }, [currentRoom, switchRoom]);

  const handleTyping = useCallback((isTyping) => {
    sendTyping(isTyping);
  }, [sendTyping]);

  if (phase === "join") {
    return <JoinScreen rooms={rooms} onJoin={handleJoin} connState={connState} />;
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>

      {/* ── Single sidebar — hides on mobile via CSS ── */}
      <div className="nc-sidebar-wrap">
        <Sidebar
          rooms={rooms}
          currentRoom={currentRoom}
          onRoomSwitch={handleRoomSwitch}
          users={users}
          metrics={metrics}
          connState={connState}
          rtt={rtt}
          onMobileClose={() => setMobileSidebar(false)}
        />
      </div>

      {/* ── Mobile overlay — only mounts when hamburger tapped ── */}
      {mobileSidebar && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex" }}>
          <div
            onClick={() => setMobileSidebar(false)}
            style={{ flex: 1, background: "rgba(0,0,0,0.5)" }}
          />
          <Sidebar
            rooms={rooms}
            currentRoom={currentRoom}
            onRoomSwitch={(room) => { handleRoomSwitch(room); setMobileSidebar(false); }}
            users={users}
            metrics={metrics}
            connState={connState}
            rtt={rtt}
            onMobileClose={() => setMobileSidebar(false)}
          />
        </div>
      )}

      {/* ── Main area ── */}
      {showMetrics ? (
        <MetricsDashboard metrics={metrics} onBack={() => setShowMetrics(false)} />
      ) : (
        <ChatWindow
          messages={messages}
          myId={socketId}
          currentRoom={currentRoom}
          typingUsers={typingUsers}
          onSend={handleSend}
          onTyping={handleTyping}
          connState={connState}
          onMenuOpen={() => setMobileSidebar(true)}
        />
      )}

      {/* ── 📊 Metrics toggle ── */}
      <button
        onClick={() => setShowMetrics(v => !v)}
        title={showMetrics ? "Back to chat" : "View performance dashboard"}
        style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 100,
          width: 44, height: 44, borderRadius: "50%",
          background: showMetrics ? "#4caf7d" : "linear-gradient(135deg,#5b63f8,#7c6af7)",
          border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18,
          boxShadow: "0 4px 20px rgba(91,99,248,0.4)",
        }}>
        {showMetrics ? "💬" : "📊"}
      </button>

      <style>{`
        .nc-sidebar-wrap { height: 100vh; }
        @media (max-width: 640px) {
          .nc-sidebar-wrap { display: none; }
          .hamburger { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
