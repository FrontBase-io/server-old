import { Collection } from "mongodb";
import {
  checkUserToken,
  comparePasswordToHash,
  getUserToken,
} from "../Utils/Functions/UserSecurity";
import { UserObjectType } from "../Utils/Types";

export default class Interactor {
  // Connection with the user
  socket;
  // The database
  db;
  // Collections
  collections: { models: Collection; objects: Collection } = {
    models: null,
    objects: null,
  };
  // Current user information
  user: UserObjectType;
  // Security level
  // 0 = Signed out
  // 1 = Signed in (username / password)
  // 2 = Basic 2fa (OTP)
  // 3 = Basic 2fa + email performed in this session
  // 4 = Advanced 2fa (security key)
  securityLevel = 0;
  // Permissions
  permissions = ["everybody"];

  constructor(socket, db) {
    this.socket = socket;
    this.db = db;
    this.collections = {
      models: db.collection("models"),
      objects: db.collection("objects"),
    };

    /* systemGetObjects */
    this.socket.on("systemGetsObjects", async (modelKey, filter, callback) => {
      // Get model
      const model = await this.collections.models.findOne({
        $or: [{ key: modelKey }, { key_plural: modelKey }],
      });

      // Get objects
      await this.collections.objects
        .find({
          ...filter,
          "meta.model": model.key,
        })
        .toArray((err, result) => {
          callback({ success: true, objects: result });
        });
    });

    /* Get token */
    this.socket.on("getToken", async (up, callback) => {
      // Get the user
      const user = (await this.collections.objects.findOne({
        "meta.model": "user",
        username: up.username,
      })) as UserObjectType;

      // Check if the submitted password is the right one
      if (comparePasswordToHash(user.password, up.password)) {
        const token = getUserToken(user);
        callback({ success: true, token });
      } else {
        callback({ success: false, reason: "wrong-password" });
      }
    });

    /* Log in*/
    this.socket.on(
      "logIn",
      async (args: { username: string; token: string }, callback) => {
        // Get the user
        const user = (await this.collections.objects.findOne({
          "meta.model": "user",
          username: args.username,
        })) as UserObjectType;

        if (checkUserToken(args.token, user)) {
          // Callback (without password hash)
          delete user.password;
          callback({ success: true, user });

          // Upgrade current session's information
          this.user = user;
          this.securityLevel = 1;
        } else {
          callback({ success: false, reason: "wrong-token" });
        }
      }
    );

    /* Up check */
    this.socket.on("alive?", async (callback) => {
      callback({ success: true });
    });
  }
}
