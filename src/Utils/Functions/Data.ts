import Interactor from "../../Interactor";
import { ModelType, ObjectType, ProcessObjectType } from "../Types";
import { ObjectId } from "mongodb";
import { findLast, map } from "lodash";
import { parseISO } from "date-fns";
import Process from "../../Process/process";

export const createObject = (
  interactor: Interactor,
  modelKey: string,
  newObject: { [key: string]: any }
) =>
  new Promise(async (resolve, reject) => {
    // Old object
    const objectToInsert = newObject;
    if (typeof modelKey !== "string") {
      reject("wrong-modelkey-type");
    } else {
      // Model
      const model = (await interactor.collections.models.findOne({
        key: modelKey,
      })) as ModelType;

      // Type of update (do we perform an updateOwn or an update?)
      if (!interactor.user) {
        reject("who-r-u");
      } else {
        // Check permissions
        let hasCreatePermissions = false;
        model.permissions.create.map((allowedPermission) => {
          if (interactor.permissions.includes(allowedPermission)) {
            hasCreatePermissions = true;
          }
        });

        if (hasCreatePermissions) {
          // Permissions are there. Proceed with update.
          map(newObject, async (fieldToUpdate, key) => {
            // Validate if we received the right data type
            let dataTypeIsValid = true;
            switch (model.fields[key].type) {
              case "text":
                if (typeof fieldToUpdate !== "string") dataTypeIsValid = false;
                break;
              case "options":
                if (typeof fieldToUpdate !== "string") dataTypeIsValid = false;
                break;
              case "number":
                if (typeof fieldToUpdate !== "number") dataTypeIsValid = false;
                break;
              case "relationship":
                if (typeof fieldToUpdate !== "string") dataTypeIsValid = false;
                break;
              case "relationship_m":
                if (!Array.isArray(fieldToUpdate)) dataTypeIsValid = false;
                break;
              case "formula":
                reject("cannot-update-formula");
                break;
              case "free-data":
                break;
              case "date":
                fieldToUpdate = parseISO(fieldToUpdate);
                break;
              case "boolean":
                if (typeof fieldToUpdate !== "boolean") dataTypeIsValid = false;
                break;
              default:
                reject("unknown-field-type");
                break;
            }

            if (dataTypeIsValid) {
              // Data validation complete.
              // Todo: transformations
              // Todo: validations

              // Add meta information
              newObject.meta = {
                model: modelKey,
                createdOn: new Date(),
                lastModifiedOn: new Date(),
                createdBy: new ObjectId(interactor.user._id),
                lastModifiedBy: new ObjectId(interactor.user._id),
                owner: new ObjectId(interactor.user._id),
              };

              // Create record
              interactor.collections.objects.insertOne(newObject).then(
                (result) => resolve(result),
                (reason) => reject(reason)
              );
            } else {
              reject("data-type-invalid");
            }
          });
        } else {
          reject("no-create-permissions");
        }
      }
    }
  });

export const deleteObject = (
  interactor: Interactor,
  modelKey: string,
  objectId: string
) =>
  new Promise(async (resolve, reject) => {
    // Old object
    if (typeof modelKey !== "string" || typeof objectId !== "string") {
      reject("wrong-argument-type");
    } else {
      // Model
      const model = (await interactor.collections.models.findOne({
        key: modelKey,
      })) as ModelType;
      // Object
      const object = (await interactor.collections.objects.findOne({
        _id: new ObjectId(objectId),
      })) as ObjectType;

      // Type of update (do we perform an updateOwn or an update?)
      if (!interactor.user) {
        reject("who-r-u");
      } else {
        // Check permissions
        const typeOfPermission =
          JSON.stringify(object.meta.owner) ===
          JSON.stringify(interactor.user._id)
            ? "delete_own"
            : "delete";
        const allowedPermissions =
          model.permissions[typeOfPermission] || model.permissions.delete;

        // Check permissions
        let hasDeletePermissions = false;
        allowedPermissions.map((allowedPermission) => {
          if (interactor.permissions.includes(allowedPermission)) {
            hasDeletePermissions = true;
          }
        });

        if (hasDeletePermissions) {
          interactor.collections.objects.deleteOne({ _id: object._id }).then(
            (result) => resolve(result),
            (reason) => reject(reason)
          );
        } else {
          reject("no-delete-permissions");
        }
      }
    }
  });

export const updateObject = (
  interactor: Interactor,
  _id: string,
  fieldsToUpdate: { [key: string]: any }
) =>
  new Promise(async (resolve, reject) => {
    // Old object
    const oldObject = (await interactor.collections.objects.findOne({
      _id: new ObjectId(_id),
    })) as ObjectType;
    // Model
    const model = (await interactor.collections.models.findOne({
      key: oldObject.meta.model,
    })) as ModelType;

    // Type of update (do we perform an updateOwn or an update?)
    if (!interactor.user) {
      reject("who-r-u");
    } else {
      const typeOfUpdate =
        JSON.stringify(oldObject.meta.owner) ===
        JSON.stringify(interactor.user._id)
          ? "update_own"
          : "update";
      const allowedPermissions =
        model.permissions[typeOfUpdate] || model.permissions.update;

      // Check permissions
      let hasUpdatePermissions = false;
      allowedPermissions.map((allowedPermission) => {
        if (interactor.permissions.includes(allowedPermission)) {
          hasUpdatePermissions = true;
        }
      });

      if (hasUpdatePermissions) {
        // Process all the processes that have a beforeChange trigger, that affect 'update' and this model.
        const processes = (await interactor.collections.objects
          .find({
            "meta.model": "process",
            "triggers.beforeChange": {
              $elemMatch: { modelKey: model.key },
            },
          })
          .toArray()) as ProcessObjectType[];

        if (processes.length > 0) {
          //@ts-ignore
          await processes.reduce(async (prev, processObject) => {
            await prev;

            const process = new Process(processObject, interactor);
            const trigger = findLast(
              processObject.triggers.beforeChange,
              (o) => o.modelKey === model.key
            );
            let processHasTriggered = false;

            // This process only fires when certain fields are updated. Check for this criterium.
            //@ts-ignore
            await trigger.fields.reduce(async (prev, curr) => {
              await prev;

              if (
                Object.keys(fieldsToUpdate).includes(curr) &&
                fieldsToUpdate[curr] !== oldObject[curr]
              )
                processHasTriggered = true;

              return curr;
            }, trigger.fields[0]);

            if (processHasTriggered) {
              fieldsToUpdate = await process.execute(trigger, {
                newObject: { ...oldObject, ...fieldsToUpdate },
                oldObject,
              });
            }

            return processObject;
          }, processes[0]);
        }

        // Permissions are there. Proceed with update.
        // Validate if we received the right data type
        let dataTypeIsValid = true;
        map(fieldsToUpdate, async (fieldToUpdate, key) => {
          // Prevent updates from being called if the before and after is the same
          if (fieldToUpdate === oldObject[key]) delete fieldToUpdate[key];

          if (key !== "_id" && key !== "meta" && key) {
            switch (model.fields[key].type) {
              case "text":
                if (typeof fieldToUpdate !== "string") dataTypeIsValid = false;
                break;
              case "options":
                if (typeof fieldToUpdate !== "string") dataTypeIsValid = false;
                break;
              case "number":
                fieldsToUpdate[key] = parseInt(fieldToUpdate);
                break;
              case "relationship":
                if (typeof fieldToUpdate !== "string") dataTypeIsValid = false;
                break;
              case "image":
                if (typeof fieldToUpdate !== "string") dataTypeIsValid = false;
                break;
              case "relationship_m":
                if (!Array.isArray(fieldToUpdate)) dataTypeIsValid = false;
                break;
              case "formula":
                reject("cannot-update-formula");
                break;
              case "free-data":
                break;
              case "color":
                if (!fieldToUpdate.r || !fieldToUpdate.g || !fieldToUpdate.b)
                  dataTypeIsValid = false;
                break;
              case "boolean":
                if (typeof fieldToUpdate !== "boolean") dataTypeIsValid = false;
                break;
              case "date":
                fieldsToUpdate[key] = parseISO(fieldToUpdate);
                break;
              default:
                reject("unknown-field-type");
                break;
            }
          } else {
            // We can't update the ID or the meta
            key === "_id" && delete fieldsToUpdate._id;
            key === "meta" && delete fieldsToUpdate.meta;
          }
        });

        if (dataTypeIsValid) {
          // Data validation complete.
          // Todo: transformations
          // Todo: validations

          // Update record
          interactor.collections.objects
            .updateOne({ _id: new ObjectId(_id) }, { $set: fieldsToUpdate })
            .then(
              (result) => resolve(result),
              (reason) => reject(reason)
            );
        } else {
          reject("data-type-invalid");
        }
      } else {
        reject("no-update-permissions");
      }
    }
  });

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

/* createModel */
export const createModel = (interactor: Interactor, model: ModelType) =>
  new Promise(async (resolve, reject) => {
    if (interactor.permissions.includes("administrators")) {
      const existingModel = await interactor.collections.models.findOne({
        $or: [{ key: model.key }, { key_plural: model.key_plural }],
      });
      if (existingModel) {
        reject("model-already-exists");
      } else {
        //@ts-ignore
        interactor.collections.models.insertOne(model).then(
          (newModel) => resolve(newModel),
          (reason) => reject(reason)
        );
      }
    } else {
      reject("no-administrator");
    }
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
        if (filter["_id"]["$in"]) {
          const newFilterId = [];
          filter["_id"]["$in"].map((_id) =>
            newFilterId.push(new ObjectId(_id))
          );
          filter["_id"]["$in"] = newFilterId;
        } else {
          filter["_id"] = new ObjectId(filter["_id"]);
        }
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

function fieldTypeIsValid(type: string, fieldToUpdate: any) {
  throw new Error("Function not implemented.");
}
