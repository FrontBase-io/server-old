# Server

Supervisor is a part of FrontBase. Server is the main interactor for `client`. It is based on `socket.io`. On any interaction it will get from the client it will perform authentication and data manipulation.

## Responsibility

Server performs the following tasks

- **Serve client** it uses `express` to serve the compiled `client`.
- **Interactions** such as
  - CRUD
- **authentication** it handles sign in. Only returns data you are authorised to see.
