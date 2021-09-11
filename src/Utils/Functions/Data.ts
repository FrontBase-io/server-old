import Interactor from "../../Interactor";
import { ModelType, ObjectType } from "../Types";
import { ObjectId } from "mongodb";

export const createObject = () => {
  console.log("Creating object");
};

/* Update models */
export const updateModel = (interactor: Interactor, model: ModelType) =>
  new Promise<void>(async (resolve, reject) => {
    if (interactor.permissions.includes("administrators")) {
      delete model._id;
      const currentModel = await interactor.collections.models.findOne({
        key: model.key,
      });
      const toUpdate = {};
      //@ts-ignore
      await Object.keys(model).reduce(async (prev, currKey) => {
        await currKey;

        if (currentModel[currKey] !== model[currKey]) {
          toUpdate[currKey] = model[currKey];
          console.log(`Updating ${currKey}`);
        }

        return currKey;
      }, Object.keys(model));

      await interactor.collections.models.updateOne(
        { key: currentModel.key },
        { $set: toUpdate }
      );

      resolve();
    } else {
      reject("no-administrator");
    }
  });

/* getModels */
export const getModels = (interactor: Interactor, filter: {}) =>
  new Promise(async (resolve, reject) => {
    await interactor.collections.models.find(filter).toArray((err, models) => {
      if (err) {
        resolve({ success: false, reason: err.message });
      }
      resolve({ success: true, models });
    });
  });

/* getModel */
export const getModel = (interactor: Interactor, modelKey: string) =>
  new Promise(async (resolve, reject) => {
    const model = await interactor.collections.models.findOne({
      $or: [{ key: modelKey }, { key_plural: modelKey }],
    });
    resolve({ success: true, model });
  });

/* getObjects */
export const getObjects = (
  interactor: Interactor,
  modelKey: string,
  filter: {}
) =>
  new Promise(async (resolve, reject) => {
    // Get model
    const model = (await interactor.collections.models.findOne({
      $or: [{ key: modelKey }, { key_plural: modelKey }],
    })) as ModelType;

    // Check if permissions are in order
    let readPermission = false;
    let readOwnPermission = false;
    model.permissions.read.map((allowedPermission) => {
      if (interactor.permissions.includes(allowedPermission))
        readPermission = true;
    });
    model.permissions.read_own.map((allowedPermission) => {
      if (interactor.permissions.includes(allowedPermission))
        readOwnPermission = true;
    });

    if (readPermission || readOwnPermission) {
      // Make sure ID is understood by Mongo
      if (filter["_id"]) {
        filter["_id"] = new ObjectId(filter["_id"]);
      }

      // Get objects
      await interactor.collections.objects
        .find({
          ...filter,
          "meta.model": model.key,
        })
        .toArray((err, objects: ObjectType[]) => {
          if (readPermission) {
            // Full read permission is present: send entire array
            resolve({ objects, model });
          } else {
            // Only read-own permission is present. Only send users own' records
            const filteredObjects = [];
            objects.map((object) => {
              if (object.meta.owner === interactor.user._id)
                filteredObjects.push(object);
            });
            resolve({ objects: filteredObjects, model });
          }
        });
    } else {
      reject("no-read-permission");
    }
  });

export const getObject = (
  interactor: Interactor,
  modelKey: string,
  filter: {}
) =>
  new Promise(async (resolve, reject) => {
    // Get model
    const model = await interactor.collections.models.findOne({
      $or: [{ key: modelKey }, { key_plural: modelKey }],
    });
    // Check if permissions are in order
    let readPermission = false;
    let readOwnPermission = false;
    model.permissions.read.map((allowedPermission) => {
      if (interactor.permissions.includes(allowedPermission))
        readPermission = true;
    });
    model.permissions.read_own.map((allowedPermission) => {
      if (interactor.permissions.includes(allowedPermission))
        readOwnPermission = true;
    });

    if (readPermission || readOwnPermission) {
      // Either permission = fetch object
      const object = (await interactor.collections.objects.findOne({
        ...filter,
        "meta.model": model.key,
      })) as ObjectType;

      if (readPermission) {
        // Full permission
        resolve({ object, model });
      } else {
        if (object.meta.owner === interactor.user._id) {
          resolve({ object, model });
        } else {
          reject("no-read-permission");
        }
      }
    } else {
      reject("no-read-permission");
    }
  });
