from fastapi import Depends, FastAPI;
from database import sessionLocal, engine
from sqlalchemy.orm import Session
import dabase_model

app = FastAPI()
dabase_model.Base.metadata.creat_all(bind=engine)

def get_db():
    try:
        db = sessionLocal()
        yield db
    finally:
        db.close()


@app.get('/')
def root_fun(db: Session = Depends(get_db)):
    db.add()
    return 'Hello from fastapi'