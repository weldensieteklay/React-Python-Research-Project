import React, { useState, useRef, useEffect } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';

const MultiCheckboxDropdown = ({ label, options, selected, onToggle, onSelectAll, placeholder, emptyMessage }) => {
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);
    const allSelected = options.length > 0 && selected.length === options.length;
    const someSelected = selected.length > 0 && !allSelected;

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const summary =
        selected.length === 0
            ? placeholder
            : selected.length === 1
                ? selected[0]
                : `${selected.length} selected`;

    const optionSx = { display: "flex", alignItems: "center", gap: 1, py: 0.5, px: 0.5, borderRadius: 1, cursor: "pointer", fontSize: "0.875rem", "&:hover": { bgcolor: "gray.50" } };
    const checkboxSx = { p: 0, flexShrink: 0, color: "gray.400", "&.Mui-checked, &.MuiCheckbox-indeterminate": { color: "blue.500" }, "& .MuiSvgIcon-root": { fontSize: 18 } };

    return (
        <Box sx={{ display: "flex", flexDirection: "column", width: 192, position: "relative" }} ref={containerRef}>
            <Typography component="label" variant="body2" sx={{ color: "gray.700", mb: 0.5 }}>{label}</Typography>

            <ButtonBase
                onClick={() => setOpen((o) => !o)}
                sx={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", px: 1.5, py: 1, border: 1, borderColor: "gray.300", borderRadius: 1, fontSize: "0.875rem", bgcolor: "common.white", textAlign: "left" }}
            >
                <Typography noWrap component="span" variant="body2" sx={{ color: selected.length === 0 ? "gray.400" : "gray.800" }} title={summary}>
                    {summary}
                </Typography>
                <KeyboardArrowDownIcon sx={{ fontSize: 16, flexShrink: 0, ml: 1, color: "gray.500", transition: "transform 150ms", transform: open ? "rotate(180deg)" : "none" }} />
            </ButtonBase>

            {open && (
                <Paper sx={{ position: "absolute", zIndex: 10, top: "100%", left: 0, mt: 0.5, width: "100%", border: 1, borderColor: "gray.300", borderRadius: 1, boxShadow: 6, maxHeight: 192, overflowY: "auto", p: 1 }}>
                    {options.length === 0 ? (
                        <Typography variant="caption" component="p" sx={{ color: "gray.400", p: 0.5 }}>{emptyMessage}</Typography>
                    ) : (
                        <>
                            <Box component="label" sx={{ ...optionSx, borderBottom: 1, borderColor: "gray.200", mb: 0.5, pb: 1, fontWeight: 500, color: "gray.700" }}>
                                <Checkbox
                                    checked={allSelected}
                                    indeterminate={someSelected}
                                    onChange={() => onSelectAll(allSelected)}
                                    sx={checkboxSx}
                                />
                                <span>Select All</span>
                            </Box>
                            {options.map((col) => (
                                <Box component="label" key={col} sx={optionSx}>
                                    <Checkbox
                                        checked={selected.includes(col)}
                                        onChange={() => onToggle(col)}
                                        sx={checkboxSx}
                                    />
                                    <Typography noWrap component="span" variant="body2" title={col}>{col}</Typography>
                                </Box>
                            ))}
                        </>
                    )}
                </Paper>
            )}
        </Box>
    );
};

export default MultiCheckboxDropdown;
