const express = require("express");
const path = require("path");
var cors = require("cors");
const fs = require("fs");
const port = 8600;
import Interactor from "./Interactor";

// Start up server
const app = express();
app.set("port", port);
let http = require("http").Server(app);

const whitelist = ["http://localhost:8600", "http://localhost:3000"];
app.use(
  cors({
    credentials: true, // This is important.
    origin: (origin, callback) => {
      if (!origin || whitelist.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS" + origin));
    },
  })
);
var cors = require("cors");
let io = require("socket.io")(http, {
  cors: {
    credentials: true, // This is important.
    origin: (origin, callback) => {
      if (!origin || whitelist.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS" + origin));
    },
  },
});

const clientBuildPath = path.join(__dirname, "..", "..", "client", "build");
// Check if the clientBuildPath exists
if (fs.existsSync(clientBuildPath)) {
  // Serve react
  app.use(express.static(clientBuildPath));
} else {
  // If not, serve a static page
  app.use(
    express.static(path.join(__dirname, "..", "static", "pages", "no-client"))
  );
}

app.use(express.static(path.join(__dirname, "..", "..", "client", "public")));
app.use("/manifest.json", (req, res, next) => {
  res.sendFile(
    path.join(__dirname, "..", "..", "client", "public", "manifest.json")
  );
});
app.use((req, res, next) => {
  res.sendFile(
    path.join(__dirname, "..", "..", "client", "build", "index.html")
  );
});

http.listen(port, () => {
  console.log(`FrontBase is now live at http://localhost:${port}`);
  // Socket
  io.on("connection", (socket) => {
    const interactor = new Interactor(socket);

    socket.on("disconnect", () => {
      console.log("user disconnected");
    });
  });
});
