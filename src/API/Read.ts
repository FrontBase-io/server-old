import { Request, Response } from "express";
import { ApiConnectionType, ModelType } from "../Utils/Types";

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
    const objects = await db
      .collection("objects")
      .find({ "meta.model": model.key })
      .toArray();
    res.send(JSON.stringify(objects));
  } else {
    res.sendStatus(405);
  }
};

export default executeReadApi;
