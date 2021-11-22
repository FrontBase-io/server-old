import { Request, Response } from "express";
import { ApiConnectionType, ModelType } from "../Utils/Types";
import { reservedQueryKeys } from "./Utils";

const executeReadApi = async (
  api: ApiConnectionType,
  db: any,
  req: Request,
  res: Response
) => {
  // First check for model's read permissions and compare it to our API's current authentication method
  const model = (await db.collection("models").findOne({
    $or: [{ key: req.params.modelKey }, { key_plural: req.params.modelKey }],
  })) as ModelType;

  if (model.permissions.read.includes(api.permission)) {
    // First loop through get parameters to find any other filter parameters
    const filter = { "meta.model": model.key };
    //@ts-ignore
    await Object.keys(req.query).reduce(async (prev, curr) => {
      await prev;

      if (!reservedQueryKeys.includes(curr)) filter[curr] = req.query[curr];

      return curr;
    }, Object.keys(req.query)[0]);

    const objects = await db.collection("objects").find(filter).toArray();
    res.send(JSON.stringify(objects.length === 1 ? objects[0] : objects));
  } else {
    res.sendStatus(405);
  }
};

export default executeReadApi;
