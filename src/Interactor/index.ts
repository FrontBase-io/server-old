import { ChangeStream } from "mongodb";
import {
  getModels,
  getObject,
  getObjects,
  updateModel,
} from "../Utils/Functions/Data";
import {
  checkUserToken,
  comparePasswordToHash,
  getUserToken,
} from "../Utils/Functions/UserSecurity";
import { DBCollectionsType, ObjectType, UserObjectType } from "../Utils/Types";
const uniqid = require("uniqid");

export default class Interactor {
  // Connection with the user
  socket;
  // The database
  db;
  // Collections
  collections: DBCollectionsType = {
    models: null,
    objects: null,
    usersettings: null,
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
  // Realtime data listeners
  objectListeners = {};
  modelListeners = [];
  changeStreams: ChangeStream[] = [];

  constructor(socket, db) {
    this.socket = socket;
    this.db = db;
    this.collections = {
      models: db.collection("models"),
      objects: db.collection("objects"),
      usersettings: db.collection("usersettings"),
    };

    // Change stream
    this.changeStreams[0] = this.collections.objects.watch();
    this.changeStreams[0].on("change", async (change) => {
      const object = (await this.collections.objects.findOne({
        ...change.documentKey,
      })) as ObjectType;

      // Loop through all the listeners for this model
      // Use a filterCache to save a query if the filter is the same
      const filterCache = {};

      (this.objectListeners[object.meta.model] || []).map((listener) => {
        if (filterCache[listener.query]) {
          // Answer with cache
          this.socket.emit(
            `receive ${listener.key}`,
            filterCache[listener.query]
          );
        } else {
          // Perform query
          getObjects(this, object.meta.model, listener.filter).then(
            ({ objects }) => {
              this.socket.emit(`receive ${listener.key}`, objects);

              // Cache the result
              filterCache[listener.filter] = objects;
            }
          );
        }
      });
    });
    this.changeStreams[1] = this.collections.models.watch();
    this.changeStreams[1].on("change", async (change) => {
      // Loop through all the listeners for this model
      // Use a filterCache to save a query if the filter is the same
      const filterCache = {};

      this.modelListeners.map((listener) => {
        if (filterCache[listener.query]) {
          // Answer with cache
          this.socket.emit(
            `receive ${listener.key}`,
            filterCache[listener.query]
          );
        } else {
          // Perform query
          getModels(this, listener.filter).then(({ models }) => {
            this.socket.emit(`receive ${listener.key}`, models);

            // Cache the result
            filterCache[listener.filter] = models;
          });
        }
      });
    });

    /* Get user settings */
    this.socket.on("getUserSetting", async (key, callback) => {
      const setting = await this.collections.usersettings.findOne({
        user: this.user._id.toString(),
        key,
      });
      callback({ success: true, value: setting.value });
    });

    /* updateModel */
    this.socket.on("updateModel", async (model, callback) => {
      updateModel(this, model).then(
        () => callback({ success: true }),
        (reason) => callback({ success: false, reason })
      );
    });

    /* getModels */
    this.socket.on("getModels", async (filter, callback) => {
      // Respond directly with the initial results
      getModels(this, filter).then(({ models }) => {
        const key = uniqid();
        callback({ success: true, key, models });

        // Also register it as a listener for live data
        this.modelListeners.push({ filter, key });
      });
    });

    /* systemGetObjects */
    this.socket.on("systemGetsObjects", async (modelKey, filter, callback) => {
      // Respond directly with the initial results
      getObjects(this, modelKey, filter).then(
        ({ objects, model }) => {
          const key = uniqid();
          callback({ success: true, key, objects });

          // Also register it as a listener for live data
          this.objectListeners[model.key] =
            this.objectListeners[modelKey] || [];
          this.objectListeners[model.key].push({ filter, key });
        },
        (reason) => {
          callback({ success: false, reason });
        }
      );
    });

    /* systemGetObject */
    // Convenience function to get just one object instead of an array
    this.socket.on("systemGetsObject", async (modelKey, filter, callback) => {
      // Respond directly with the initial results
      getObject(this, modelKey, filter).then(
        ({ object, model }) => {
          const key = uniqid();
          callback({ success: true, key, object });

          // Also register it as a listener for live data
          this.objectListeners[model.key] =
            this.objectListeners[modelKey] || [];
          this.objectListeners[model.key].push({ filter, key });
        },
        (reason) => {
          callback({ success: false, reason });
        }
      );
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

    /* Token log in*/
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
          console.log(`${user.username} is online!`);

          this.user = user;
          this.securityLevel = 1;
          this.permissions.push("users");

          // Figure out all the user's permissions
          user.roles.map(async (roleKey) => {
            const role = await this.collections.objects.findOne({
              _id: roleKey,
            });
            role.permissions.map(async (permissionKey) => {
              const permission = await this.collections.objects.findOne({
                _id: permissionKey,
              });
              if (!this.permissions.includes(permission.name)) {
                this.permissions.push(permission.name);
              }
            });
          });
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
