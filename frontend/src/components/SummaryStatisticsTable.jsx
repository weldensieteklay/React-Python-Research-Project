import React from "react";
import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

const SummaryStatisticsTable = ({ stats, showExtended = true }) => {
  if (!stats || stats.length === 0) return null;

  return (
    <Box sx={{ width: "100%", mt: 3 }}>
      <Typography variant="h3" sx={{ fontSize: "1.125rem", fontWeight: 600, mb: 2, textAlign: "center" }}>
        Summary Statistics
      </Typography>

      <Table
        sx={{
          width: "100%", border: 1, borderColor: "gray.300",
          "& .MuiTableCell-root": { border: 1, borderColor: "gray.200", p: 1, fontSize: "inherit" },
          "& .MuiTableCell-body": { textAlign: "center" },
        }}
      >
        <TableHead sx={{ bgcolor: "gray.100" }}>
          <TableRow sx={{ "& .MuiTableCell-root": { fontWeight: 700, textAlign: "center" } }}>
            <TableCell>Variable</TableCell>
            <TableCell>Type</TableCell>

            {showExtended && <TableCell>Average (All)</TableCell>}
            {showExtended && <TableCell>Average (Non-Missing)</TableCell>}

            <TableCell>Missing</TableCell>

            <TableCell>
              Statistic
            </TableCell>
          </TableRow>
        </TableHead>

        <TableBody>
          {stats.map((stat) => (
            <TableRow key={stat.column}>
              <TableCell>
                {stat.column}
              </TableCell>

              <TableCell>
                {stat.type}
              </TableCell>

              {showExtended && (
                <>
                  <TableCell>
                    {stat.averageAll ?? "-"}
                  </TableCell>

                  <TableCell>
                    {stat.averageNonMissing ?? "-"}
                  </TableCell>
                </>
              )}

              <TableCell>
                {stat.missingCount}
              </TableCell>

              <TableCell sx={{ "&&": { textAlign: "left" } }}>
                {stat.type === "Numeric" ? (
                  <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                    <div>
                      <strong>Mean:</strong> {stat.mean}
                    </div>

                    <div>
                      <strong>Std. Error:</strong> {stat.standardError}
                    </div>
                  </Box>
                ) : (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                    {Object.entries(stat.frequencies).map(([value, info]) => (
                      <Box
                        key={value}
                        sx={{ display: "flex", justifyContent: "space-between", borderBottom: 1, borderColor: "gray.200", py: 0.5, "&:last-of-type": { borderBottom: 0 } }}
                      >
                        <span>{value}</span>

                        <span>
                          {info.count} ({info.percentage}%)
                        </span>
                      </Box>
                    ))}
                  </Box>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
};

export default SummaryStatisticsTable;
