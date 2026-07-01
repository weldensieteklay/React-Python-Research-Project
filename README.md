# React-Python-Research-Project

#Run backend

#Run frontend
#npm start

##########################################
Recommended architecture
React Frontend
    ↓
FastAPI Backend
    ↓
AI Imputation Strategy Engine (Claude/OpenAI)
    ↓
Pandas Execution Engine
    ↓
Return cleaned dataset + cleaning log
PART 1 — React frontend

You only need 3 frontend pieces.

1. File Upload Component
<input
  type="file"
  accept=".csv,.xlsx"
  onChange={handleFileUpload}
/>
2. User Goal Input

This is VERY important because the AI uses context.

<textarea
  placeholder="What are you trying to predict or analyze?"
  value={userGoal}
  onChange={(e) => setUserGoal(e.target.value)}
/>

Example:

"Predict Dallas rental prices"
"Analyze employment trends"
"Estimate causal effect of education"
3. Send dataset to backend
const formData = new FormData();

formData.append("file", file);
formData.append("user_goal", userGoal);
formData.append("data_type", "econometrics");

const response = await fetch(
  "http://localhost:8000/clean-data",
  {
    method: "POST",
    body: formData,
  }
);

const result = await response.json();

setCleaningLog(result.cleaning_log);
setPreview(result.preview);
PART 2 — FastAPI backend

Install:

pip install fastapi uvicorn pandas python-multipart anthropic
Backend route
from fastapi import FastAPI, UploadFile, Form
import pandas as pd
import io

app = FastAPI()

@app.post("/clean-data")
async def clean_data(
    file: UploadFile,
    user_goal: str = Form(...),
    data_type: str = Form(...)
):

    contents = await file.read()

    df = pd.read_csv(io.BytesIO(contents))

    cleaned_df, cleaning_log = await clean_input_data(
        df,
        data_type,
        user_goal
    )

    return {
        "cleaning_log": cleaning_log,
        "preview": cleaned_df.head(10).to_dict(orient="records")
    }
PART 3 — Claude/OpenAI AI decision engine

This is the brain.

Install Anthropic SDK
pip install anthropic
Claude client
import anthropic
import json
import os

client = anthropic.Anthropic(
    api_key=os.getenv("ANTHROPIC_API_KEY")
)
AI strategy generator
async def ai_imputation_strategy(df, data_type, user_goal):

    column_profiles = {}

    for col in df.columns:

        profile = {
            "dtype": str(df[col].dtype),
            "missing_pct": round(df[col].isnull().mean() * 100, 2),
            "unique_values": int(df[col].nunique())
        }

        if df[col].dtype != 'object':
            profile["mean"] = float(df[col].mean())
            profile["median"] = float(df[col].median())
            profile["skewness"] = float(df[col].skew())

        column_profiles[col] = profile

    prompt = f"""
    You are an applied econometrics expert.

    User goal:
    {user_goal}

    Data type:
    {data_type}

    Column profiles:
    {json.dumps(column_profiles)}

    Decide best imputation method for each column.

    Return JSON only.
    """

    response = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=1500,
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ]
    )

    return json.loads(response.content[0].text)
PART 4 — Actual dataframe cleaning engine

This is deterministic execution.

AI execution layer
async def apply_ai_imputation(df, strategy):

    cleaning_log = {}

    for col, decision in strategy.items():

        method = decision["method"]

        if method == "median":
            df[col].fillna(df[col].median(), inplace=True)

        elif method == "mean":
            df[col].fillna(df[col].mean(), inplace=True)

        elif method == "mode":
            df[col].fillna(df[col].mode()[0], inplace=True)

        elif method == "drop_rows":
            df.dropna(subset=[col], inplace=True)

        elif method == "drop_column":
            df.drop(columns=[col], inplace=True)

        elif method == "interpolate":
            df[col].interpolate(inplace=True)

        cleaning_log[col] = decision

    return df, cleaning_log
Main cleaning function
async def clean_input_data(df, data_type, user_goal):

    df.replace('', pd.NA, inplace=True)

    df.drop_duplicates(inplace=True)

    strategy = await ai_imputation_strategy(
        df,
        data_type,
        user_goal
    )

    cleaned_df, cleaning_log = await apply_ai_imputation(
        df,
        strategy
    )

    return cleaned_df, cleaning_log
PART 5 — React display layer

Display the AI cleaning decisions.

{cleaningLog &&
  Object.entries(cleaningLog).map(([col, info]) => (
    <div key={col}>
      <strong>{col}</strong> → {info.method}
      <p>{info.reason}</p>
    </div>
))}
What makes this architecture powerful

Your app becomes:

Upload dataset
    ↓
AI analyzes missingness semantically
    ↓
AI chooses econometric cleaning strategy
    ↓
Python executes safely
    ↓
React explains every decision

This is no longer a CRUD app.

It becomes:

AI-assisted econometrics platform
causal analytics assistant
intelligent preprocessing engine
What you should add next (important)

After this works:

Add:
confidence scores
anomaly detection
target leakage detection
automatic feature typing
panel data detection
time series detection

Those are the features that make the system genuinely advanced.

Important production recommendation

DO NOT let Claude directly modify data.

Correct architecture is:

Claude decides
Python executes

Never:

execute arbitrary AI-generated code
eval model output
run generated Pandas dynamically