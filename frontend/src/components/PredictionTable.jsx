import React from "react";
import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

const headSx = { px: 2, py: 1, fontSize: "0.875rem", fontWeight: 500, color: "gray.700" };
const cellSx = { px: 2, py: 1, fontSize: "0.875rem", color: "gray.600" };

const PredictionTable = ({ result }) => {
  if (!result || !result.data || !Array.isArray(result.data)) {
    return <Typography sx={{ color: "red.500" }}>No model summary available.</Typography>;
  }

  return (
    <Box sx={{ mt: 3, width: "100%", maxWidth: 1024, mx: "auto" }}>
      <Typography variant="h2" sx={{ fontSize: "1.25rem", fontWeight: 600, color: "gray.800", mb: 2 }}>{`${result.model} Results`}</Typography>

      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 2, fontSize: "0.875rem", color: "gray.700", mb: 3 }}>
        <div><strong>Stationary:</strong> {result.stationary ? "Yes" : "No"}</div>
        <div><strong>ADF p-value:</strong> {result.adfuller}</div>
        <div><strong>AIC:</strong> {result.aic}</div>
        <div><strong>BIC:</strong> {result.bic}</div>
        {result.mse && <div><strong>MSE:</strong> {result.mse}</div>}
        {result.rmse && <div><strong>RMSE:</strong> {result.rmse}</div>}
        {result.mae && <div><strong>MAE:</strong> {result.mae}</div>}
        {result.mape && <div><strong>MAPE:</strong> {result.mape}</div>}
      </Box>

      <Typography variant="h2" sx={{ fontSize: "1.125rem", fontWeight: 600, color: "gray.800", mb: 1 }}>Model Coefficients</Typography>
      <TableContainer>
        <Table size="small" sx={{ minWidth: "100%", border: 1, borderColor: "gray.300" }}>
          <TableHead sx={{ bgcolor: "gray.100" }}>
            <TableRow>
              <TableCell sx={headSx}>Field</TableCell>
              <TableCell sx={headSx}>Mean</TableCell>
              <TableCell sx={headSx}>Std Error</TableCell>
              <TableCell sx={headSx}>p-value</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {result.data.map((row, idx) => (
              <TableRow key={idx} hover>
                <TableCell sx={cellSx}>{row.field_name}</TableCell>
                <TableCell sx={cellSx}>{row.mean}</TableCell>
                <TableCell sx={cellSx}>{row.standard_error}</TableCell>
                <TableCell sx={cellSx}>{row.p_value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default PredictionTable;
