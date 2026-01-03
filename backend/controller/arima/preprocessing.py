import pandas as pd
from .helpers import is_valid_date

import pandas as pd
import numpy as np



def clean_input_data(raw_data):
    """Remove empty strings, NaN, or None values."""
    df = pd.DataFrame(raw_data)
    df.replace('', np.nan, inplace=True)
    df.dropna(inplace=True)
    return df

    

def detect_columns(first_object):
    """Automatically detect date and target columns."""
    date_column, target_column = None, None
    for key, value in first_object.items():
        if is_valid_date(value):
            date_column = key
        else:
            target_column = key
    return date_column, target_column

def prepare_dataframe(actual_data, date_column, target_column):
    df = pd.DataFrame(actual_data)
    df[date_column] = pd.to_datetime(df[date_column])
    df[target_column] = pd.to_numeric(df[target_column], errors='coerce')
    df.sort_values(by=date_column, inplace=True)
    
    # Create lagged variables
    for lag in range(1, 4):
        df[f"{target_column}_{lag}"] = df[target_column].shift(lag)
    df.dropna(inplace=True)
    
    return df.set_index(date_column)
