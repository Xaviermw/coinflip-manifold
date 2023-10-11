library(jsonlite)

CONFIDENCE_Z_SCORE = 1.28

json_data_raw<-fromJSON("manifold_dump.json")
binary_old <- json_data_raw[json_data_raw$outcomeType == "BINARY",]
resolved_binary <- binary_old[binary_old$isResolved,]
resolved_yes_no <- resolved_binary[(resolved_binary$resolution == "YES" | resolved_binary$resolution == "NO"), ]

resolution_table <- table(resolved_yes_no[,c(3, 24)])

resolution_table <- as.data.frame.matrix(resolution_table)
resolution_table$sample_size <- resolution_table$YES + resolution_table$NO
resolution_table$percentage <- resolution_table$YES/resolution_table$sample_size
resolution_table$lower_ci <- resolution_table$percentage-CONFIDENCE_Z_SCORE*sqrt(resolution_table$percentage*(1-resolution_table$percentage)/resolution_table$sample_size)
resolution_table$upper_ci <- resolution_table$percentage+CONFIDENCE_Z_SCORE*sqrt(resolution_table$percentage*(1-resolution_table$percentage)/resolution_table$sample_size)

resolution_table$lower_ci[resolution_table$lower_ci<0] <- 0
resolution_table$upper_ci[resolution_table$upper_ci>1] <- 1
resolution_table$target <- "Low Sample Size"
resolution_table[(resolution_table$lower_ci > .55) & resolution_table$sample_size > 10, ]$target <- "Target Yes"
resolution_table[(resolution_table$upper_ci < .45) & resolution_table$sample_size > 10, ]$target <- "Target No"
resolution_table[(resolution_table$upper_ci > .45) & (resolution_table$lower_ci < .55) & resolution_table$sample_size > 10, ]$target <- "Balanced User"
resolution_table$username <- rownames(resolution_table)

target_json <- toJSON(resolution_table)
write(target_json, "targets.json")
