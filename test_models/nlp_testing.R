library(readr)
# a collection of package for data wrangling.
library(tidyverse)
# package for text processing
library(tidytext)
# collection of packages for modeling and L 
library(tidymodels)
library(scales)
# R package for managing and analyzing textual data
library(quanteda)
# An R package with word stemming algorithm
# collapsing words to a common root to aid comparison of vocabular. 
library(SnowballC)
# library for topic models (LDA)
library(topicmodels)
# text recipe
library(textrecipes)
# dealing with imbalance data using `step_downsample or upsample`.
library(themis)
# https://github.com/tidymodels/discrim
library(discrim)
# framework for constructing variable importance plots from ML models
library(vip)

train_data_header <- read.csv("~/Xavier_Backup/Manifold/docs/train_data_header.csv")

text_df <- train_data_header %>%
  select(Result, Question) %>%
  unnest_tokens(word, Question)

removed_stop_words <- text_df %>%
  anti_join(stop_words[stop_words$lexicon == "snowball",], by = "word")

stem_words <- removed_stop_words %>%
  mutate(stem = wordStem(word))

stem_words %>% count(word, sort =TRUE) %>% 
  filter(n > 500) %>% 
  mutate(word = reorder(word,n)) %>%
  ggplot(aes(x = n, y = word)) + geom_col() +
  labs(title = "Words with > 200 occurrence in the markets")

frequency <- removed_stop_words %>% count(Result, word) %>% group_by(Result) %>%
  mutate(proportion = n / sum(n)) %>% select(-n) %>% 
  pivot_wider(names_from = Result, values_from = proportion) %>%
  rename(No = `NO`) %>%
  pivot_longer(3,names_to ="Yes",values_to = "proportion")

ggplot(frequency, aes(x = proportion, y = No, color = abs(No - proportion)))+
  geom_abline(color = "gray40", lty = 2) +
  geom_jitter(alpha = 0.1, size = 2.5, width = 0.3, height = 0.3) +
  geom_text(aes(label = word), check_overlap = TRUE, vjust = 1.5) +
  scale_x_log10(labels = percent_format()) +
  scale_y_log10(labels = percent_format()) +
  scale_color_gradient(limits = c(0, 0.001),
                       low = "darkslategray4", high = "gray75") +
  theme(legend.position = "none") +
  labs(y = "No", x = "Yes", title = "Comparing the Word Frequencies of Different Annotation", subtitle = "Words far from the line are words found more in one set of texts than another")

tidymodels_prefer()

questionsDF2class <-  train_data_header %>%
  mutate(outcome = factor(Result)) %>% 
  arrange(desc(outcome))

set.seed(123)

question_df_split <- questionsDF2class %>% initial_split(0.7, strata = outcome)

question_df_train <- training(question_df_split)
question_df_test <- testing(question_df_split)


question_rec <- recipe(outcome ~ Question, data = question_df_train) %>%
  step_tokenize(Question) %>% # tokenization
  step_stopwords(Question)%>% # stopwords removal
  step_stem(Question) %>% # stem
  step_tokenfilter(Question, max_tokens = 1e3) %>% # select tokens
  step_tfidf(Question) # convert to tf-idf

nb_spec <- naive_Bayes() %>%
  set_mode("classification") %>%
  set_engine("naivebayes") 

lasso_spec <- logistic_reg(penalty = 0.01, mixture = 1) %>%
  set_mode("classification") %>%
  set_engine("glmnet")

nb_fit <- workflow() %>% 
  add_recipe(question_rec) %>%
  add_model(nb_spec) %>%
  fit(data = question_df_train)

lasso_fit <- workflow() %>%
  add_recipe(question_rec) %>%
  add_model(lasso_spec) %>%
  fit(data = question_df_train)

question_folds <- vfold_cv(question_df_train, v = 3)
question_folds

lasso_wf <- workflow() %>%
  add_recipe(question_rec) %>%
  add_model(lasso_spec)

lasso_rs <- fit_resamples(
  lasso_wf,
  question_folds,
  control = control_resamples(save_pred = TRUE))

lasso_rs_metrics <- collect_metrics(lasso_rs)
lasso_rs_predictions <- collect_predictions(lasso_rs)
lasso_rs_metrics

lasso_rs_predictions %>%
  group_by(id) %>%
  roc_curve(truth = outcome, .pred_YES, event_level = "second") %>%
  autoplot() +
  labs(
    color = NULL,
    title = "ROC curve (lasso, no upsampling)",
    subtitle = "Each resample fold is shown in a different color"
  )

lasso_rs_predictions %>%
  group_by(id) %>%
  pr_curve(truth = outcome, .pred_YES, event_level = "second") %>%
  autoplot()+
  labs(
    color = NULL,
    title = "Precision Recall curve (lasso, no upsampling)",
    subtitle = "Each resample fold is shown in a different color"
  )

final_wf <- last_fit(lasso_wf, question_df_split)
collect_metrics(final_wf)

collect_predictions(final_wf) %>%
  conf_mat(truth = outcome, estimate = .pred_class) %>%
  autoplot(type = "heatmap")

collect_predictions(final_wf)  %>%
  roc_curve(truth = outcome, .pred_YES, event_level = "second") %>%
  autoplot() +
  labs(
    color = NULL,
    title = "ROC curve",
    subtitle = "With final tuned lasso regularized classifier on the test set"
  )


final_imp <- extract_fit_parsnip(final_wf$.workflow[[1]]) %>%
  vip::vi()

final_imp%>%filter(Sign == "POS") %>% arrange(desc(Importance)) %>% head(10)

final_imp %>%
  mutate(
    Sign = case_when(Sign == "POS" ~ "More likely resolves Yes",
                     Sign == "NEG" ~ "More likely resolves No"),
    Variable = str_remove_all(Variable, "tfidf_processed_tweet_"),
    Variable = str_remove_all(Variable, "textfeature_narrative_copy_")
  ) %>%
  group_by(Sign) %>%
  top_n(20, Importance) %>%
  ungroup %>%
  ggplot(aes(x = Importance,
             y = fct_reorder(Variable, Importance),
             fill = Sign)) +
  geom_col(show.legend = FALSE) +
  scale_x_continuous(expand = c(0, 0)) +
  facet_wrap(~Sign, scales = "free") +
  labs(
    y = NULL,
    title = "Variable importance for predicting positive resolution",
    subtitle = paste0("These features are the most important in predicting\n",
                      "whether the market will resolve yes or not")
  )

lasso_fit <- workflow() %>%
  add_recipe(question_rec) %>%
  add_model(lasso_spec) %>%
  fit(data = train_data_header)
