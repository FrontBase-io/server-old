import { DBCollectionsType } from "../Types";

export const createObject = () => {
  console.log("Creating object");
};

export const getObjects = (
  collections: DBCollectionsType,
  modelKey: string,
  filter: {}
) =>
  new Promise(async (resolve, reject) => {
    // Get model
    const model = await collections.models.findOne({
      $or: [{ key: modelKey }, { key_plural: modelKey }],
    });

    // Get objects
    await collections.objects
      .find({
        ...filter,
        "meta.model": model.key,
      })
      .toArray((err, objects) => {
        resolve({ objects, model });
      });
  });

export const getObject = (
  collections: DBCollectionsType,
  modelKey: string,
  filter: {}
) =>
  new Promise(async (resolve, reject) => {
    // Get model
    const model = await collections.models.findOne({
      $or: [{ key: modelKey }, { key_plural: modelKey }],
    });

    // Get objects
    const object = await collections.objects.findOne({
      ...filter,
      "meta.model": model.key,
    });
    resolve({ object, model });
  });
