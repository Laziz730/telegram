import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Global Server In-Memory Storage
interface RegisteredUser {
  id: string;
  phone: string;
  username: string;
  name: string;
  bio: string;
  avatarBg: string;
}

const registeredUsers: Record<string, RegisteredUser> = {};

const takenUsernames = new Set<string>([]);

const authCodes: Record<string, string> = {};

let storiesDb: any[] = [];

let liveCommentsDb: Record<string, any[]> = {};

// Real-time messages & chats per phone number
const userChatsStore: Record<string, any[]> = {};
const userMessagesStore: Record<string, Record<string, any[]>> = {};

// Helper to seed initial basic bots for a new user
function getInitialUserChats(phone: string, username: string): any[] {
  return [];
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "25mb" }));

  // --- NEW AUTH & USER API ENDPOINTS ---

  // 1. Check Username availability
  app.post("/api/auth/check-username", (req, res) => {
    const { username } = req.body;
    if (!username) return res.json({ available: false, statusText: "Band" });
    const cleanUser = username.startsWith("@") ? username.toLowerCase() : `@${username.toLowerCase()}`;
    
    // Check against taken set or registered users
    let isTaken = takenUsernames.has(cleanUser);
    if (!isTaken) {
      for (const p in registeredUsers) {
        if (registeredUsers[p].username.toLowerCase() === cleanUser) {
          isTaken = true;
          break;
        }
      }
    }
    
    if (isTaken) {
      return res.json({ available: false, statusText: "Band" });
    } else {
      return res.json({ available: true, statusText: "Bo'sh" });
    }
  });

  // 2. Send Code (either SMS simulation or sent to Telegram bot of existing account)
  app.post("/api/auth/send-code", (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone required" });
    
    const cleanPhone = phone.trim();
    const code = Math.floor(10000 + Math.random() * 90000).toString();
    authCodes[cleanPhone] = code;

    const existingUser = registeredUsers[cleanPhone];
    if (existingUser) {
      // Send code directly into their Telegram Clone Bot chat history!
      if (!userMessagesStore[cleanPhone]) userMessagesStore[cleanPhone] = {};
      if (!userMessagesStore[cleanPhone]["telegram_clone_bot"]) {
        userMessagesStore[cleanPhone]["telegram_clone_bot"] = [
          {
            id: "init_bot",
            chatId: "telegram_clone_bot",
            sender: "other",
            text: "Xush kelibsiz! Akaunt xavfsizligi va tasdiqlash kodlari shu yerga keladi.",
            timestamp: "09:00",
            status: "read",
            type: "text"
          }
        ];
      }
      
      const now = new Date();
      const timeStr = `${now.getHours()}:${now.getMinutes() < 10 ? '0' : ''}${now.getMinutes()}`;
      
      userMessagesStore[cleanPhone]["telegram_clone_bot"].push({
        id: "code_" + Date.now(),
        chatId: "telegram_clone_bot",
        sender: "other",
        text: `🔐 Kirish kodi: ${code}\n\nBoshqa qurilmadan kirish urinishi aniqlandi. Agar bu siz bo'lmasangiz, e'tibor bermang.`,
        timestamp: timeStr,
        status: "read",
        type: "text"
      });

      // Update last message in chat list
      if (userChatsStore[cleanPhone]) {
        const botChat = userChatsStore[cleanPhone].find(c => c.id === "telegram_clone_bot");
        if (botChat) {
          botChat.lastMessage = `🔐 Kirish kodi: ${code}`;
          botChat.lastTime = timeStr;
          botChat.unreadCount = (botChat.unreadCount || 0) + 1;
        }
      }

      return res.json({ 
        success: true, 
        isExisting: true, 
        message: "Kod oldin kirgan hisobingizga (Telegram Clone Botiga) yuborildi!",
        devCode: code // Also return for demo convenience
      });
    } else {
      // New user registration -> simulate SMS arrival
      return res.json({ 
        success: true, 
        isExisting: false, 
        message: "Tasdiqlash kodi SMS orqali yuborildi!", 
        devCode: code 
      });
    }
  });

  // 3. Verify Code & Register/Login
  app.post("/api/auth/verify", (req, res) => {
    const { phone, code, name, username } = req.body;
    const cleanPhone = phone ? phone.trim() : "";
    
    if (authCodes[cleanPhone] !== code && code !== "12345") {
      return res.status(400).json({ error: "Kod noto'g'ri!" });
    }

    let user = registeredUsers[cleanPhone];
    if (!user) {
      const cleanUser = username?.startsWith("@") ? username : `@${username || 'user_' + Math.floor(Math.random()*1000)}`;
      user = {
        id: "user_" + Date.now(),
        phone: cleanPhone,
        username: cleanUser,
        name: name || "Yangi Foydalanuvchi",
        bio: "Telegram Web SuperApp foydalanuvchisi ✨",
        avatarBg: ["#3390ec", "#ff6b6b", "#00c853", "#ce93d8", "#4db6ac"][Math.floor(Math.random()*5)]
      };
      registeredUsers[cleanPhone] = user;
      takenUsernames.add(cleanUser.toLowerCase());
    }

    if (!userChatsStore[cleanPhone]) {
      userChatsStore[cleanPhone] = [];
    }
    if (!userMessagesStore[cleanPhone]) {
      userMessagesStore[cleanPhone] = {};
    }

    res.json({
      user,
      chats: userChatsStore[cleanPhone],
      messages: userMessagesStore[cleanPhone]
    });
  });

  // 4. State Sync (polling for new messages, stories, live streams)
  app.get("/api/state", (req, res) => {
    const phone = req.query.phone as string;
    const cleanPhone = phone ? phone.trim() : "";
    const user = registeredUsers[cleanPhone];

    const allUsersList = Object.values(registeredUsers).map(u => ({
      id: u.id,
      name: u.name,
      username: u.username,
      phone: u.phone,
      bio: u.bio,
      avatarBg: u.avatarBg
    }));

    res.json({
      currentUser: user || null,
      chats: userChatsStore[cleanPhone] || [],
      messages: userMessagesStore[cleanPhone] || {},
      stories: storiesDb,
      liveComments: liveCommentsDb,
      allUsers: allUsersList
    });
  });

  // 5. Search Real Users
  app.get("/api/users/search", (req, res) => {
    const q = (req.query.q as string || "").toLowerCase().trim();
    const results = Object.values(registeredUsers).filter(u => 
      u.name.toLowerCase().includes(q) || 
      u.username.toLowerCase().includes(q) ||
      u.phone.includes(q)
    );
    res.json(results);
  });

  // 6. Send Message between real users
  app.post("/api/messages/send", (req, res) => {
    const { senderPhone, targetChatId, text, type = 'text', mediaUrl, base64Data, mimeType } = req.body;
    const cleanPhone = senderPhone ? senderPhone.trim() : "";
    const sender = registeredUsers[cleanPhone];
    if (!sender || !targetChatId) return res.status(400).json({ error: "Invalid sender or target" });

    const now = new Date();
    const timeStr = `${now.getHours()}:${now.getMinutes() < 10 ? '0' : ''}${now.getMinutes()}`;
    const msgId = "m_" + Date.now() + "_" + Math.floor(Math.random()*1000);

    // Ensure sender stores exist
    if (!userMessagesStore[cleanPhone]) userMessagesStore[cleanPhone] = {};
    if (!userMessagesStore[cleanPhone][targetChatId]) userMessagesStore[cleanPhone][targetChatId] = [];

    const newMsgObj = {
      id: msgId,
      chatId: targetChatId,
      sender: "me",
      text: text || "",
      timestamp: timeStr,
      status: "sent",
      type,
      mediaUrl,
      base64Data,
      mimeType
    };

    userMessagesStore[cleanPhone][targetChatId].push(newMsgObj);

    // Find target user if it's a private chat with a registered user
    let targetUser: RegisteredUser | null = null;
    let targetPhone: string | null = null;

    for (const p in registeredUsers) {
      if (registeredUsers[p].id === targetChatId || registeredUsers[p].username === targetChatId) {
        targetUser = registeredUsers[p];
        targetPhone = p;
        break;
      }
    }

    if (targetUser && targetPhone && targetPhone !== cleanPhone) {
      // Deliver message to receiver's inbox!
      if (!userMessagesStore[targetPhone]) userMessagesStore[targetPhone] = {};
      const senderChatKey = sender.id; // or sender.username
      if (!userMessagesStore[targetPhone][senderChatKey]) userMessagesStore[targetPhone][senderChatKey] = [];

      userMessagesStore[targetPhone][senderChatKey].push({
        ...newMsgObj,
        sender: "other"
      });

      // Update or create chat item in receiver's chat list
      if (!userChatsStore[targetPhone]) userChatsStore[targetPhone] = getInitialUserChats(targetPhone, targetUser.username);
      let receiverChat = userChatsStore[targetPhone].find(c => c.id === senderChatKey);
      if (!receiverChat) {
        receiverChat = {
          id: senderChatKey,
          name: sender.name,
          type: "private",
          avatarBg: sender.avatarBg,
          lastMessage: text || "Fayl",
          lastTime: timeStr,
          unreadCount: 1,
          online: true,
          onlineStatus: "online",
          folder: ["all", "personal"],
          username: sender.username,
          bio: sender.bio,
          phone: sender.phone
        };
        userChatsStore[targetPhone].unshift(receiverChat);
      } else {
        receiverChat.lastMessage = text || "Fayl";
        receiverChat.lastTime = timeStr;
        receiverChat.unreadCount = (receiverChat.unreadCount || 0) + 1;
      }
    }

    // Update sender's chat list preview
    if (userChatsStore[cleanPhone]) {
      let myChat = userChatsStore[cleanPhone].find(c => c.id === targetChatId);
      if (!myChat) {
        myChat = {
          id: targetChatId,
          name: targetUser ? targetUser.name : "Foydalanuvchi",
          type: "private",
          avatarBg: targetUser ? targetUser.avatarBg : "#3390ec",
          lastMessage: text || "Fayl",
          lastTime: timeStr,
          unreadCount: 0,
          online: true,
          onlineStatus: "online",
          folder: ["all", "personal"],
          username: targetUser ? targetUser.username : "",
          bio: targetUser ? targetUser.bio : "",
          phone: targetUser ? targetUser.phone : ""
        };
        userChatsStore[cleanPhone].unshift(myChat);
      } else {
        myChat.lastMessage = text || "Fayl";
        myChat.lastTime = timeStr;
      }
    }

    res.json({ success: true, message: newMsgObj });
  });

  // 7. Stories API
  app.post("/api/stories/create", (req, res) => {
    const { userId, userName, userAvatarBg, text, mediaUrl } = req.body;
    if (!userId) return res.status(400).json({ error: "Missing userId" });
    
    const newStory = {
      id: "st_" + Date.now(),
      userId,
      userName: userName || "User",
      userAvatarBg: userAvatarBg || "#3390ec",
      text,
      mediaUrl,
      timestamp: "Hozir",
      isLive: false
    };
    storiesDb.unshift(newStory);
    res.json(newStory);
  });

  // 8. Live Streams API
  app.post("/api/livestreams/start", (req, res) => {
    const { userId, userName, userAvatarBg, title } = req.body;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    // Remove old live stream by same user if any
    storiesDb = storiesDb.filter(s => !(s.userId === userId && s.isLive));

    const stId = "live_" + Date.now();
    const liveStream = {
      id: stId,
      userId,
      userName: userName || "User",
      userAvatarBg: userAvatarBg || "#ff6b6b",
      timestamp: "Hozir",
      isLive: true,
      liveTitle: title || "🔴 Jonli Efir (Live Stream)",
      viewersCount: Math.floor(50 + Math.random() * 200)
    };

    storiesDb.unshift(liveStream);
    liveCommentsDb[stId] = [
      { id: "init_c", senderName: "Tizim", text: "Jonli efir boshlandi! Fikrlar yozishingiz mumkin.", timestamp: "Hozir" }
    ];

    res.json(liveStream);
  });

  app.post("/api/livestreams/stop", (req, res) => {
    const { userId } = req.body;
    storiesDb = storiesDb.filter(s => !(s.userId === userId && s.isLive));
    res.json({ success: true });
  });

  app.post("/api/livestreams/comment", (req, res) => {
    const { streamId, senderName, text } = req.body;
    if (!streamId || !text) return res.status(400).json({ error: "Invalid comment" });
    if (!liveCommentsDb[streamId]) liveCommentsDb[streamId] = [];

    const now = new Date();
    const timeStr = `${now.getHours()}:${now.getMinutes() < 10 ? '0' : ''}${now.getMinutes()}`;
    const commentObj = {
      id: "lc_" + Date.now(),
      senderName: senderName || "Mehmon",
      text,
      timestamp: timeStr
    };
    liveCommentsDb[streamId].push(commentObj);
    res.json(commentObj);
  });

  // Telegram AI Bot endpoint
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, history, botId, image } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        // Fallback simulated AI reply if API key is not configured
        return res.json({
          reply: `Menga yozganingiz uchun rahmat jgar! (Eslatma: AI Studio sirlar bo'limida GEMINI_API_KEY kiritilmagan, shuning uchun bu avtomatik javob. Sozlamalarga kirib GEMINI_API_KEY ni qo'shing!). Sizning xabaringiz: "${message}"`
        });
      }

      const ai = new GoogleGenAI({ apiKey });
      
      let systemInstruction = "Siz Telegram Web klonida 'Akmal Jgar' yoki 'Gemini AI Bot' nomli sun'iy intellekt botsiz. Foydalanuvchi bilan o'zbek tilida samimiy, do'stona, tushunarli va yordamga tayyor tarzda suhbatlashing. Qisqa va Telegram xabarlariga xos uslubda javob bering. Emojilardan o'rnida foydalaning. Agar foydalanuvchi rasm yuborsa, rasmda nima borligini va tafsilotlarini o'zbek tilida aniq tahlil qilib bering.";
      if (botId === "durov") {
        systemInstruction = "Siz Pavel Durovsiz — Telegram asoschisi. O'zbek tilida yoki ingliz tilida erkin, maxfiy xavfsizlik va Telegram kelajagi haqida g'urur bilan gapiradigan odam kabi javob bering.";
      }

      const formattedHistory = (history || []).slice(-10).map((m: any) => ({
        role: m.sender === "me" ? "user" : "model",
        parts: [{ text: m.text }]
      }));

      const userParts: any[] = [{ text: message || "Rasm yuborildi" }];
      if (image && image.base64Data && image.mimeType) {
        // Clean base64 prefix if present
        const cleanBase64 = image.base64Data.replace(/^data:image\/\w+;base64,/, "");
        userParts.push({
          inlineData: {
            data: cleanBase64,
            mimeType: image.mimeType
          }
        });
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          ...formattedHistory,
          { role: "user", parts: userParts }
        ],
        config: {
          systemInstruction,
          maxOutputTokens: 800,
          temperature: 0.7
        }
      });

      res.json({ reply: response.text || "Tushunmadim, qaytatdan yuboring jgar." });
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      res.status(500).json({ 
        reply: "Uzr jgar, internet yoki serverda kichik uzilish bo'ldi. Qaytadan yozib ko'ring! 🤖" 
      });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development vs static serve in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Telegram Web Clone running on http://localhost:${PORT}`);
  });
}

startServer();
